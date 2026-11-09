#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";
import { Interface, getAddress } from "ethers";

const CANDIDATE_URL = process.env.RPC_QUALIFY_CANDIDATE_URL || "https://rpc2.monad.xyz";
const CANONICAL_URL = process.env.RPC_QUALIFY_CANONICAL_URL || "https://rpc.monad.xyz";
const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || "deployments/monad-mainnet.json";
const OUTPUT_FILE = process.env.RPC_QUALIFY_OUTPUT_FILE || "tasks/evidence/rpc2-mainnet-qualification.json";
const RANGE = Number(process.env.RPC_QUALIFY_LOG_RANGE || "10000");
const SAMPLE_RANGE = Number(process.env.RPC_QUALIFY_SAMPLE_RANGE || "100");
const SAMPLE_COUNT = Number(process.env.RPC_QUALIFY_SAMPLE_COUNT || "24");
const MAX_REQUESTS = Number(process.env.RPC_QUALIFY_MAX_REQUESTS || "2500");
const TIMEOUT_MS = Number(process.env.RPC_QUALIFY_TIMEOUT_MS || "30000");
let requestCount = 0;
let id = 0;

function activeDeployment() {
  const manifest = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const entry = [...manifest.contracts].reverse().find((item) =>
    item.role === "EverDraw V5 mainnet beta - ADR-0045 draw-manager activation");
  if (!entry) throw new Error("Active V5 mainnet deployment not found");
  return entry;
}

async function rpc(url, method, params) {
  requestCount++;
  if (requestCount > MAX_REQUESTS) throw new Error(`Qualification request budget exceeded: ${MAX_REQUESTS}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(`${new URL(url).hostname} ${method}: ${JSON.stringify(body.error || body)}`);
    return body.result;
  } finally {
    clearTimeout(timer);
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
function digest(logs) {
  const normalized = logs.map(normalizeLog).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return "0x" + createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
function evenlySpacedRanges(from, to, count, width) {
  if (to < from) return [];
  const maxStart = Math.max(from, to - width + 1);
  if (count === 1) return [[from, Math.min(to, from + width - 1)]];
  return Array.from({ length: count }, (_, index) => {
    const start = Math.round(from + (maxStart - from) * index / (count - 1));
    return [start, Math.min(to, start + width - 1)];
  });
}

async function main() {
  if (!Number.isSafeInteger(RANGE) || RANGE < 1000) throw new Error("Invalid RPC_QUALIFY_LOG_RANGE");
  const deployment = activeDeployment();
  const addresses = Object.values(deployment.addresses).filter((value) => /^0x[0-9a-fA-F]{40}$/.test(value)).map(getAddress);
  const fromBlock = Number(deployment.startBlock);
  const [candidateChain, canonicalChain, candidateHeadHex, canonicalHeadHex] = await Promise.all([
    rpc(CANDIDATE_URL, "eth_chainId", []),
    rpc(CANONICAL_URL, "eth_chainId", []),
    rpc(CANDIDATE_URL, "eth_blockNumber", []),
    rpc(CANONICAL_URL, "eth_blockNumber", []),
  ]);
  if (BigInt(candidateChain) !== 143n || BigInt(canonicalChain) !== 143n) throw new Error("Chain ID mismatch");
  const candidateHead = Number(BigInt(candidateHeadHex));
  const canonicalHead = Number(BigInt(canonicalHeadHex));
  if (Math.abs(candidateHead - canonicalHead) > 10) throw new Error("Candidate head is stale");
  const toBlock = Math.min(candidateHead, canonicalHead);

  const fullLogs = [];
  const windows = [];
  for (let start = fromBlock; start <= toBlock; start += RANGE) {
    const end = Math.min(toBlock, start + RANGE - 1);
    const logs = await rpc(CANDIDATE_URL, "eth_getLogs", [{ address: addresses, fromBlock: blockTag(start), toBlock: blockTag(end) }]);
    for (const log of logs) {
      const canonical = await rpc(CANONICAL_URL, "eth_getBlockByNumber", [log.blockNumber, false]);
      if (!canonical?.hash || canonical.hash.toLowerCase() !== log.blockHash.toLowerCase()) {
        throw new Error(`Non-canonical candidate log at ${log.blockNumber}`);
      }
    }
    fullLogs.push(...logs);
    windows.push({ fromBlock: start, toBlock: end, logCount: logs.length });
  }

  const samples = [];
  for (const [start, end] of evenlySpacedRanges(fromBlock, toBlock, SAMPLE_COUNT, SAMPLE_RANGE)) {
    const filter = { address: addresses, fromBlock: blockTag(start), toBlock: blockTag(end) };
    const [candidate, canonical, candidateStart, canonicalStart, candidateEnd, canonicalEnd] = await Promise.all([
      rpc(CANDIDATE_URL, "eth_getLogs", [filter]),
      rpc(CANONICAL_URL, "eth_getLogs", [filter]),
      rpc(CANDIDATE_URL, "eth_getBlockByNumber", [blockTag(start), false]),
      rpc(CANONICAL_URL, "eth_getBlockByNumber", [blockTag(start), false]),
      rpc(CANDIDATE_URL, "eth_getBlockByNumber", [blockTag(end), false]),
      rpc(CANONICAL_URL, "eth_getBlockByNumber", [blockTag(end), false]),
    ]);
    const candidateDigest = digest(candidate);
    const canonicalDigest = digest(canonical);
    if (candidateDigest !== canonicalDigest) throw new Error(`Log completeness mismatch ${start}-${end}`);
    if (!candidateStart?.hash || candidateStart.hash.toLowerCase() !== canonicalStart?.hash?.toLowerCase()) {
      throw new Error(`Start boundary mismatch ${start}-${end}`);
    }
    if (!candidateEnd?.hash || candidateEnd.hash.toLowerCase() !== canonicalEnd?.hash?.toLowerCase()) {
      throw new Error(`End boundary mismatch ${start}-${end}`);
    }
    samples.push({
      fromBlock: start,
      toBlock: end,
      logCount: candidate.length,
      digest: candidateDigest,
      startHash: candidateStart.hash,
      endHash: candidateEnd.hash,
    });
  }

  const iface = new Interface(["function vault() view returns (address)"]);
  const stateBlocks = [...new Set([
    fromBlock + 100,
    Math.round(fromBlock + (toBlock - fromBlock) * 0.25),
    Math.round(fromBlock + (toBlock - fromBlock) * 0.5),
    Math.round(fromBlock + (toBlock - fromBlock) * 0.75),
    toBlock,
  ])];
  const historicalState = [];
  for (const block of stateBlocks) {
    const params = [{ to: deployment.addresses.drawManager, data: iface.encodeFunctionData("vault") }, blockTag(block)];
    const [candidate, canonical] = await Promise.all([
      rpc(CANDIDATE_URL, "eth_call", params),
      rpc(CANONICAL_URL, "eth_call", params),
    ]);
    if (candidate.toLowerCase() !== canonical.toLowerCase()) throw new Error(`Historical state mismatch at ${block}`);
    historicalState.push({ blockNumber: block, resultHash: "0x" + createHash("sha256").update(candidate).digest("hex") });
  }

  const receiptSamples = [];
  const txHashes = [...new Set(fullLogs.map((log) => log.transactionHash))];
  for (const txHash of [txHashes[0], txHashes[Math.floor(txHashes.length / 2)], txHashes.at(-1)].filter(Boolean)) {
    const [candidate, canonical] = await Promise.all([
      rpc(CANDIDATE_URL, "eth_getTransactionReceipt", [txHash]),
      rpc(CANONICAL_URL, "eth_getTransactionReceipt", [txHash]),
    ]);
    const candidateLogs = (candidate?.logs || []).filter((log) => addresses.some((address) => address.toLowerCase() === log.address.toLowerCase()));
    const canonicalLogs = (canonical?.logs || []).filter((log) => addresses.some((address) => address.toLowerCase() === log.address.toLowerCase()));
    if (digest(candidateLogs) !== digest(canonicalLogs)) throw new Error(`Receipt mismatch ${txHash}`);
    receiptSamples.push({ txHash, blockNumber: Number(BigInt(candidate.blockNumber)), digest: digest(candidateLogs) });
  }

  const evidence = {
    schemaVersion: 1,
    qualifiedAt: new Date().toISOString(),
    candidate: { urlOrigin: new URL(CANDIDATE_URL).origin, operator: "Goldsky Edge (per Monad official RPC provider documentation)" },
    canonical: { urlOrigin: new URL(CANONICAL_URL).origin, operator: "QuickNode (per Monad official network documentation)" },
    chainId: "143",
    deploymentRole: deployment.role,
    fromBlock,
    toBlock,
    addresses,
    configuredLogRange: RANGE,
    fullScan: { windowCount: windows.length, logCount: fullLogs.length, digest: digest(fullLogs), windows },
    exactCanonicalSamples: samples,
    historicalState,
    receiptSamples,
    requestCount,
    maxRequests: MAX_REQUESTS,
    verdict: "qualified-for-v5-independent-logs-and-historical-state",
  };
  fs.mkdirSync(new URL("../..", import.meta.url), { recursive: true });
  fs.mkdirSync(OUTPUT_FILE.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
