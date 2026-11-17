#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { FetchRequest, JsonRpcProvider, getAddress } from "ethers";
import { compute } from "../draw/compute-winners.js";
import { buildWatcherDrawInput, ingestWatcherReconstructionLogs } from "../draw/reconstruct-watcher-input.mjs";
import { disableHiddenTransportRetries } from "./incident-policy.mjs";

const CANDIDATE_URL = process.env.RPC_QUALIFY_CANDIDATE_URL || "https://rpc2.monad.xyz";
const REFERENCE_URL = process.env.RPC_QUALIFY_REFERENCE_URL;
const CANONICAL_URL = process.env.RPC_QUALIFY_CANONICAL_URL || "https://rpc.monad.xyz";
const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || "deployments/monad-mainnet.json";
const OUTPUT_FILE = process.env.RPC_QUALIFY_OUTPUT_FILE || "tasks/evidence/rpc2-mainnet-qualification.json";
const INPUT_FILE = process.env.RPC_QUALIFY_EVIDENCE_INPUT_FILE;
const APPROVED_COMMIT = process.env.RPC_QUALIFY_APPROVED_COMMIT;
const QUALIFICATION_ID = process.env.RPC_QUALIFY_ID;
const ADMISSION_FILE = process.env.RPC_QUALIFY_ADMISSION_FILE;
const PROVIDER_PERIOD = process.env.RPC_QUALIFY_PROVIDER_PERIOD;
const ACCOUNT_REQUEST_CAP = Number(process.env.RPC_QUALIFY_ACCOUNT_REQUEST_CAP || "15000");
const COOLDOWN_SEC = Number(process.env.RPC_QUALIFY_COOLDOWN_SEC || "86400");
const RANGE = Number(process.env.RPC_QUALIFY_LOG_RANGE || "10000");
const MAX_REQUESTS = Number(process.env.RPC_QUALIFY_MAX_REQUESTS || "2500");
const TIMEOUT_MS = Number(process.env.RPC_QUALIFY_TIMEOUT_MS || "30000");
const MIN_REQUEST_INTERVAL_MS = Number(process.env.RPC_QUALIFY_MIN_REQUEST_INTERVAL_MS || "250");
const rpcQueues = new Map();
const rpcLastStartedAt = new Map();
let requestCount = 0;
let id = 0;
let admissionState;
let progressEvidence;

function required(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function currentCommit() {
  return spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(file.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const handle = fs.openSync(temp, "w", 0o600);
  try {
    fs.writeFileSync(handle, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temp, file);
  const directory = fs.openSync(file.split("/").slice(0, -1).join("/") || ".", "r");
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
}

function withAdmissionLock(operation) {
  const lockFile = `${ADMISSION_FILE}.lock`;
  let handle;
  try {
    handle = fs.openSync(lockFile, "wx", 0o600);
    fs.writeFileSync(handle, `${process.pid}\n`);
    fs.fsyncSync(handle);
  } catch (error) {
    if (handle != null) fs.closeSync(handle);
    if (error?.code === "EEXIST") throw new Error("Qualification admission ledger is locked by another process");
    throw error;
  }
  try {
    return operation();
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lockFile);
  }
}

function initializeAdmission() {
  required(ADMISSION_FILE, "RPC_QUALIFY_ADMISSION_FILE");
  required(PROVIDER_PERIOD, "RPC_QUALIFY_PROVIDER_PERIOD");
  if (!Number.isSafeInteger(ACCOUNT_REQUEST_CAP) || ACCOUNT_REQUEST_CAP < 1) throw new Error("Invalid RPC_QUALIFY_ACCOUNT_REQUEST_CAP");
  if (!Number.isSafeInteger(COOLDOWN_SEC) || COOLDOWN_SEC < 0) throw new Error("Invalid RPC_QUALIFY_COOLDOWN_SEC");
  fs.mkdirSync(ADMISSION_FILE.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  withAdmissionLock(() => {
    if (fs.existsSync(ADMISSION_FILE)) {
      admissionState = JSON.parse(fs.readFileSync(ADMISSION_FILE, "utf8"));
      if (
        admissionState.version !== 1
        || admissionState.periodId !== PROVIDER_PERIOD
        || !Number.isSafeInteger(admissionState.usedRequests)
        || admissionState.usedRequests < 0
        || admissionState.usedRequests > ACCOUNT_REQUEST_CAP
        || typeof admissionState.qualifications !== "object"
        || admissionState.qualifications == null
      ) throw new Error("Qualification admission state is invalid or belongs to another provider period");
    } else {
      admissionState = { version: 1, periodId: PROVIDER_PERIOD, usedRequests: 0, qualifications: {} };
    }
    const previousStarts = Object.values(admissionState.qualifications)
      .map((entry) => Date.parse(entry.startedAt))
      .filter(Number.isFinite);
    if (!admissionState.qualifications[QUALIFICATION_ID] && previousStarts.length > 0) {
      const latest = Math.max(...previousStarts);
      if (Date.now() - latest < COOLDOWN_SEC * 1000) throw new Error("Qualification provider cooldown is still active");
    }
    admissionState.qualifications[QUALIFICATION_ID] ||= {
      sourceHead: currentCommit(),
      startedAt: new Date().toISOString(),
      requests: 0,
    };
    if (admissionState.qualifications[QUALIFICATION_ID].sourceHead !== currentCommit()) {
      throw new Error("Qualification ID is already bound to another source commit");
    }
    atomicWriteJson(ADMISSION_FILE, admissionState);
  });
}

function reserveQualificationRequests(count) {
  const amount = Number(count);
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Invalid qualification request count");
  if (requestCount + amount > MAX_REQUESTS) throw new Error(`Qualification request budget exceeded: ${MAX_REQUESTS}`);
  withAdmissionLock(() => {
    admissionState = JSON.parse(fs.readFileSync(ADMISSION_FILE, "utf8"));
    if (admissionState.periodId !== PROVIDER_PERIOD || !admissionState.qualifications?.[QUALIFICATION_ID]) {
      throw new Error("Qualification admission changed during execution");
    }
    if (admissionState.usedRequests + amount > ACCOUNT_REQUEST_CAP) throw new Error("Qualification provider-period request budget exceeded");
    requestCount += amount;
    admissionState.usedRequests += amount;
    admissionState.qualifications[QUALIFICATION_ID].requests += amount;
    admissionState.qualifications[QUALIFICATION_ID].updatedAt = new Date().toISOString();
    atomicWriteJson(ADMISSION_FILE, admissionState);
  });
}

function persistProgress(patch = {}) {
  if (!progressEvidence) return;
  progressEvidence = { ...progressEvidence, ...patch, updatedAt: new Date().toISOString() };
  atomicWriteJson(OUTPUT_FILE, progressEvidence);
}

function readQualificationInput() {
  const input = JSON.parse(fs.readFileSync(required(INPUT_FILE, "RPC_QUALIFY_EVIDENCE_INPUT_FILE"), "utf8"));
  if (input.schemaVersion !== 2 || input.chainId !== "143") throw new Error("Invalid qualification evidence input");
  if (!Number.isSafeInteger(input.finalBlock) || input.finalBlock < 1 || !/^0x[0-9a-fA-F]{64}$/.test(input.finalBlockHash)) {
    throw new Error("Qualification input requires a pinned finalBlock/finalBlockHash");
  }
  if (!Array.isArray(input.knownEvents) || !Array.isArray(input.draws)) throw new Error("Qualification input events/draws are missing");
  const kinds = new Set(input.knownEvents.map((event) => event.kind));
  for (const kind of ["seed", "proposal", "finalization", "mint", "transfer", "burn"]) {
    if (!kinds.has(kind)) throw new Error(`Qualification input has no independently known ${kind} event`);
  }
  if (input.draws.length < 1) throw new Error("Qualification input requires at least one known finalized paying draw");
  return input;
}

function scheduleRpc(url, operation) {
  const origin = new URL(url).origin;
  const previous = rpcQueues.get(origin) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const waitMs = Math.max(0, (rpcLastStartedAt.get(origin) || 0) + MIN_REQUEST_INTERVAL_MS - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    rpcLastStartedAt.set(origin, Date.now());
    return operation();
  });
  rpcQueues.set(origin, next);
  return next;
}

function activeDeployment() {
  const manifest = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const entry = [...manifest.contracts].reverse().find((item) =>
    item.role === "EverDraw V5 mainnet beta - ADR-0045 draw-manager activation");
  if (!entry) throw new Error("Active V5 mainnet deployment not found");
  return entry;
}

async function rpc(url, method, params) {
  reserveQualificationRequests(1);
  return scheduleRpc(url, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: controller.signal,
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`${new URL(url).hostname} ${method}: HTTP ${response.status} ${text.slice(0, 200)}`);
      }
      if (!response.ok || body.error) throw new Error(`${new URL(url).hostname} ${method}: ${JSON.stringify(body.error || body)}`);
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  });
}

class QualificationProvider extends JsonRpcProvider {
  constructor(url) {
    const request = new FetchRequest(url);
    disableHiddenTransportRetries(request);
    request.timeout = TIMEOUT_MS;
    super(request, 143, { staticNetwork: true, batchMaxCount: 1 });
    this.qualificationUrl = url;
  }

  async _send(payload) {
    const requests = Array.isArray(payload) ? payload : [payload];
    reserveQualificationRequests(requests.length);
    return scheduleRpc(this.qualificationUrl, () => super._send(payload));
  }
}

function blockTag(number) {
  return "0x" + Number(number).toString(16);
}
function normalizeLog(log) {
  return [
    Number(BigInt(log.blockNumber)),
    Number(BigInt(log.transactionIndex)),
    Number(BigInt(log.logIndex)),
    log.address.toLowerCase(),
    log.transactionHash.toLowerCase(),
    log.blockHash.toLowerCase(),
    log.data.toLowerCase(),
    ...log.topics.map((topic) => topic.toLowerCase()),
  ];
}

function reconstructionLog(log) {
  return {
    ...log,
    blockNumber: Number(BigInt(log.blockNumber)),
    transactionIndex: Number(BigInt(log.transactionIndex)),
    logIndex: Number(BigInt(log.logIndex)),
    index: Number(BigInt(log.logIndex)),
  };
}

function eventIdentity(log) {
  return `${log.transactionHash.toLowerCase()}:${Number(BigInt(log.logIndex))}`;
}

export function assertKnownEvents(fullLogs, knownEvents) {
  const logs = new Map(fullLogs.map((log) => [eventIdentity(log), log]));
  for (const expected of knownEvents) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(expected.txHash) || !Number.isSafeInteger(expected.logIndex)) {
      throw new Error(`Invalid known ${expected.kind} event identity`);
    }
    const log = logs.get(`${expected.txHash.toLowerCase()}:${expected.logIndex}`);
    if (!log) throw new Error(`Known ${expected.kind} event is missing: ${expected.txHash}:${expected.logIndex}`);
    if (Number(BigInt(log.blockNumber)) !== expected.blockNumber) throw new Error(`Known ${expected.kind} block mismatch`);
    if (log.blockHash.toLowerCase() !== expected.blockHash.toLowerCase()) throw new Error(`Known ${expected.kind} block hash mismatch`);
    if (log.address.toLowerCase() !== expected.address.toLowerCase()) throw new Error(`Known ${expected.kind} address mismatch`);
    if (log.topics[0].toLowerCase() !== expected.topic0.toLowerCase()) throw new Error(`Known ${expected.kind} topic mismatch`);
  }
}
function digest(logs) {
  const normalized = logs.map(normalizeLog).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return "0x" + createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
async function main() {
  if (!Number.isSafeInteger(RANGE) || RANGE < 1000) throw new Error("Invalid RPC_QUALIFY_LOG_RANGE");
  if (!Number.isSafeInteger(MAX_REQUESTS) || MAX_REQUESTS < 1) throw new Error("Invalid RPC_QUALIFY_MAX_REQUESTS");
  required(REFERENCE_URL, "RPC_QUALIFY_REFERENCE_URL");
  required(APPROVED_COMMIT, "RPC_QUALIFY_APPROVED_COMMIT");
  required(QUALIFICATION_ID, "RPC_QUALIFY_ID");
  const sourceHead = currentCommit();
  if (sourceHead !== APPROVED_COMMIT) throw new Error(`Qualification source mismatch: ${sourceHead} != ${APPROVED_COMMIT}`);
  initializeAdmission();
  const qualificationInput = readQualificationInput();
  const deployment = activeDeployment();
  if (qualificationInput.deploymentRole !== deployment.role) throw new Error("Qualification deployment role mismatch");
  const addresses = Object.values(deployment.addresses).filter((value) => /^0x[0-9a-fA-F]{40}$/.test(value)).map(getAddress);
  const fromBlock = Number(deployment.startBlock);
  progressEvidence = {
    schemaVersion: 2,
    qualificationId: QUALIFICATION_ID,
    status: "running",
    startedAt: new Date().toISOString(),
    sourceHead,
    approvedCommit: APPROVED_COMMIT,
    inputDigest: "0x" + createHash("sha256").update(fs.readFileSync(INPUT_FILE)).digest("hex"),
    chainId: "143",
    deploymentRole: deployment.role,
    fromBlock,
    toBlock: qualificationInput.finalBlock,
    completedWindows: [],
    requestCount,
    maxRequests: MAX_REQUESTS,
    providerPeriod: PROVIDER_PERIOD,
    providerPeriodUsedRequests: admissionState.usedRequests,
    providerPeriodRequestCap: ACCOUNT_REQUEST_CAP,
  };
  persistProgress();
  const [candidateChain, referenceChain, canonicalChain, candidateHeadHex, referenceHeadHex, canonicalHeadHex] = await Promise.all([
    rpc(CANDIDATE_URL, "eth_chainId", []),
    rpc(REFERENCE_URL, "eth_chainId", []),
    rpc(CANONICAL_URL, "eth_chainId", []),
    rpc(CANDIDATE_URL, "eth_blockNumber", []),
    rpc(REFERENCE_URL, "eth_blockNumber", []),
    rpc(CANONICAL_URL, "eth_blockNumber", []),
  ]);
  if (BigInt(candidateChain) !== 143n || BigInt(referenceChain) !== 143n || BigInt(canonicalChain) !== 143n) {
    throw new Error("Chain ID mismatch");
  }
  const candidateHead = Number(BigInt(candidateHeadHex));
  const referenceHead = Number(BigInt(referenceHeadHex));
  const canonicalHead = Number(BigInt(canonicalHeadHex));
  const toBlock = qualificationInput.finalBlock;
  if (Math.min(candidateHead, referenceHead, canonicalHead) < toBlock) throw new Error("A qualification provider is behind the pinned final block");
  const [candidateFinal, referenceFinal, canonicalFinal] = await Promise.all([
    rpc(CANDIDATE_URL, "eth_getBlockByNumber", [blockTag(toBlock), false]),
    rpc(REFERENCE_URL, "eth_getBlockByNumber", [blockTag(toBlock), false]),
    rpc(CANONICAL_URL, "eth_getBlockByNumber", [blockTag(toBlock), false]),
  ]);
  const pinnedHash = qualificationInput.finalBlockHash.toLowerCase();
  if ([candidateFinal, referenceFinal, canonicalFinal].some((block) => block?.hash?.toLowerCase() !== pinnedHash)) {
    throw new Error("Pinned final block hash mismatch");
  }

  const fullLogs = [];
  const windows = [];
  for (let start = fromBlock; start <= toBlock; start += RANGE) {
    const end = Math.min(toBlock, start + RANGE - 1);
    const filter = { address: addresses, fromBlock: blockTag(start), toBlock: blockTag(end) };
    const [candidate, reference, candidateStart, referenceStart, candidateEnd, referenceEnd] = await Promise.all([
      rpc(CANDIDATE_URL, "eth_getLogs", [filter]),
      rpc(REFERENCE_URL, "eth_getLogs", [filter]),
      rpc(CANDIDATE_URL, "eth_getBlockByNumber", [blockTag(start), false]),
      rpc(REFERENCE_URL, "eth_getBlockByNumber", [blockTag(start), false]),
      rpc(CANDIDATE_URL, "eth_getBlockByNumber", [blockTag(end), false]),
      rpc(REFERENCE_URL, "eth_getBlockByNumber", [blockTag(end), false]),
    ]);
    if (digest(candidate) !== digest(reference)) throw new Error(`Full-history log mismatch ${start}-${end}`);
    if (candidateStart?.hash?.toLowerCase() !== referenceStart?.hash?.toLowerCase()) throw new Error(`Start boundary mismatch ${start}-${end}`);
    if (candidateEnd?.hash?.toLowerCase() !== referenceEnd?.hash?.toLowerCase()) throw new Error(`End boundary mismatch ${start}-${end}`);
    fullLogs.push(...candidate);
    windows.push({
      fromBlock: start,
      toBlock: end,
      logCount: candidate.length,
      digest: digest(candidate),
      startHash: candidateStart.hash,
      endHash: candidateEnd.hash,
    });
    persistProgress({
      completedThroughBlock: end,
      completedWindows: windows,
      fullHistoryLogCount: fullLogs.length,
      requestCount,
      providerPeriodUsedRequests: admissionState.usedRequests,
    });
  }

  assertKnownEvents(fullLogs, qualificationInput.knownEvents);
  const receiptSamples = [];
  const txHashes = [...new Set(qualificationInput.knownEvents.map((event) => event.txHash.toLowerCase()))];
  for (const txHash of txHashes) {
    const [candidate, reference, canonical] = await Promise.all([
      rpc(CANDIDATE_URL, "eth_getTransactionReceipt", [txHash]),
      rpc(REFERENCE_URL, "eth_getTransactionReceipt", [txHash]),
      rpc(CANONICAL_URL, "eth_getTransactionReceipt", [txHash]),
    ]);
    const candidateLogs = (candidate?.logs || []).filter((log) => addresses.some((address) => address.toLowerCase() === log.address.toLowerCase()));
    const referenceLogs = (reference?.logs || []).filter((log) => addresses.some((address) => address.toLowerCase() === log.address.toLowerCase()));
    const canonicalLogs = (canonical?.logs || []).filter((log) => addresses.some((address) => address.toLowerCase() === log.address.toLowerCase()));
    if (digest(candidateLogs) !== digest(referenceLogs) || digest(candidateLogs) !== digest(canonicalLogs)) {
      throw new Error(`Known-event receipt mismatch ${txHash}`);
    }
    receiptSamples.push({ txHash, blockNumber: Number(BigInt(candidate.blockNumber)), digest: digest(candidateLogs) });
  }

  const reconstructed = ingestWatcherReconstructionLogs({
    logs: fullLogs.map(reconstructionLog),
    vaultAddress: deployment.addresses.prizeVault,
    drawManagerAddress: deployment.addresses.drawManager,
  });
  if (reconstructed.accounts.length < 1) throw new Error("Full history produced no participant accounts");
  const candidateProvider = new QualificationProvider(CANDIDATE_URL);
  const referenceProvider = new QualificationProvider(REFERENCE_URL);
  const reconstructedDraws = [];
  try {
    for (const expected of qualificationInput.draws) {
      const drawId = BigInt(expected.drawId);
      const seedBlock = reconstructed.seedBlocks[drawId.toString()];
      if (!seedBlock || seedBlock !== expected.seedBlock) throw new Error(`Known draw ${drawId} seed block mismatch`);
      const [candidateInput, referenceInput] = await Promise.all([
        buildWatcherDrawInput({
          provider: candidateProvider,
          drawManagerAddress: deployment.addresses.drawManager,
          drawId,
          seedBlock,
          participantAccounts: reconstructed.accounts,
        }),
        buildWatcherDrawInput({
          provider: referenceProvider,
          drawManagerAddress: deployment.addresses.drawManager,
          drawId,
          seedBlock,
          participantAccounts: reconstructed.accounts,
        }),
      ]);
      const candidateResult = compute(candidateInput);
      const referenceResult = compute(referenceInput);
      const expectedRoot = expected.root.toLowerCase();
      if (candidateResult.root.toLowerCase() !== expectedRoot || referenceResult.root.toLowerCase() !== expectedRoot) {
        throw new Error(`Known draw ${drawId} reconstructed root mismatch`);
      }
      if (candidateInput.totalTwab !== referenceInput.totalTwab) throw new Error(`Known draw ${drawId} total TWAB mismatch`);
      if (expected.totalTwab != null && candidateInput.totalTwab !== String(expected.totalTwab)) {
        throw new Error(`Known draw ${drawId} expected total TWAB mismatch`);
      }
      const inputDigest = "0x" + createHash("sha256").update(JSON.stringify(candidateInput)).digest("hex");
      reconstructedDraws.push({
        drawId: drawId.toString(),
        seedBlock,
        root: expectedRoot,
        totalTwab: candidateInput.totalTwab,
        participantCount: candidateInput.accounts.length,
        prizeLegCount: candidateInput.prizeLegs.length,
        inputDigest,
      });
    }
  } finally {
    candidateProvider.destroy();
    referenceProvider.destroy();
  }

  const evidence = {
    schemaVersion: 2,
    qualificationId: required(QUALIFICATION_ID, "RPC_QUALIFY_ID"),
    qualifiedAt: new Date().toISOString(),
    sourceHead: currentCommit(),
    approvedCommit: APPROVED_COMMIT,
    prMergeSha: process.env.RPC_QUALIFY_PR_MERGE_SHA || null,
    inputDigest: "0x" + createHash("sha256").update(fs.readFileSync(INPUT_FILE)).digest("hex"),
    candidate: { urlOrigin: new URL(CANDIDATE_URL).origin, operator: "Goldsky Edge (per Monad official RPC provider documentation)" },
    reference: { urlOrigin: new URL(REFERENCE_URL).origin },
    canonical: { urlOrigin: new URL(CANONICAL_URL).origin, operator: "QuickNode (per Monad official network documentation)" },
    chainId: "143",
    deploymentRole: deployment.role,
    fromBlock,
    toBlock,
    addresses,
    configuredLogRange: RANGE,
    pinnedFinalBlock: { number: toBlock, hash: pinnedHash },
    fullHistoryAgreement: { windowCount: windows.length, logCount: fullLogs.length, digest: digest(fullLogs), windows },
    knownEvents: qualificationInput.knownEvents,
    receiptSamples,
    reconstructedDraws,
    requestCount,
    maxRequests: MAX_REQUESTS,
    providerPeriod: PROVIDER_PERIOD,
    providerPeriodUsedRequests: admissionState.usedRequests,
    providerPeriodRequestCap: ACCOUNT_REQUEST_CAP,
    status: "qualified",
    verdict: "qualified-for-v5-independent-logs-and-historical-state",
  };
  progressEvidence = evidence;
  persistProgress();
  console.log(JSON.stringify(evidence, null, 2));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    persistProgress({
      status: "incomplete",
      verdict: "not-qualified",
      failure: { code: error?.code || "QUALIFICATION_FAILED", message: String(error?.message || error) },
      requestCount,
      providerPeriodUsedRequests: admissionState?.usedRequests,
    });
    console.error(error);
    process.exitCode = 1;
  });
}
