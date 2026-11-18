import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Interface } from "ethers";

import { compute } from "../draw/compute-winners.js";
import { QualificationProvider } from "./qualify-mainnet-provider.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "scripts/rpc/qualify-mainnet-provider.mjs");
const TOKEN = "qualification-test-token-that-is-long-enough";
const ZERO = "0x0000000000000000000000000000000000000000";
const addresses = {
  prizeVault: "0x0000000000000000000000000000000000000011",
  drawManager: "0x0000000000000000000000000000000000000022",
  claimManager: "0x0000000000000000000000000000000000000033",
  twabController: "0x0000000000000000000000000000000000000044",
  payoutToken: "0x0000000000000000000000000000000000000055",
  participant: "0x0000000000000000000000000000000000000066",
};
const managerInterface = new Interface([
  "function vault() view returns (address)",
  "function claimManager() view returns (address)",
  "function twabController() view returns (address)",
  "function payoutToken() view returns (address)",
  "function draws(uint256) view returns (uint64,uint64,uint64,bytes32,uint256,uint256,uint32,uint32,bytes32,uint64,address,uint8,uint256,uint256,uint256)",
  "function drawRewardLegCount(uint256) view returns (uint256)",
  "function drawFeeRecipientCount(uint256) view returns (uint256)",
  "event SeedReceived(uint256 indexed drawId,uint64 indexed requestId,bytes32 seed)",
]);
const vaultInterface = new Interface(["event Transfer(address indexed from,address indexed to,uint256 amount)"]);
const twabInterface = new Interface([
  "function getTwabBetween(address,address,uint256,uint256) view returns (uint256)",
]);
const seed = word(777);
const finalHash = word(101);

function word(value) {
  return "0x" + BigInt(value).toString(16).padStart(64, "0");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function json(res, status, body, headers = {}) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(encoded), ...headers });
  res.end(encoded);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function buildLogs() {
  const transfer = vaultInterface.encodeEventLog(vaultInterface.getEvent("Transfer"), [ZERO, addresses.participant, 10n]);
  const seeded = managerInterface.encodeEventLog(managerInterface.getEvent("SeedReceived"), [1n, 9n, seed]);
  const base = (index, address, topics, data) => ({
    address,
    blockHash: word(100),
    blockNumber: "0x64",
    data,
    logIndex: `0x${index.toString(16)}`,
    removed: false,
    topics,
    transactionHash: word(index + 1),
    transactionIndex: "0x0",
  });
  return [
    base(0, addresses.prizeVault, transfer.topics, transfer.data),
    base(1, addresses.drawManager, seeded.topics, seeded.data),
    ...Array.from({ length: 4 }, (_, offset) =>
      base(offset + 2, addresses.claimManager, [word(900 + offset)], "0x")),
  ];
}

function resultFor(method, params, logs) {
  if (method === "eth_chainId") return "0x8f";
  if (method === "eth_blockNumber") return "0x65";
  if (method === "eth_getBlockByNumber") {
    const number = Number(BigInt(params[0]));
    return { hash: word(number), number: params[0], parentHash: word(number - 1), timestamp: "0x1" };
  }
  if (method === "eth_getLogs") return logs;
  if (method === "eth_getTransactionReceipt") return { blockNumber: "0x64", logs };
  if (method !== "eth_call") throw new Error(`Unexpected RPC method ${method}`);

  const data = params[0].data.toLowerCase();
  if (data.startsWith(managerInterface.getFunction("claimManager").selector)) {
    return managerInterface.encodeFunctionResult("claimManager", [addresses.claimManager]);
  }
  if (data.startsWith(managerInterface.getFunction("draws").selector)) {
    return managerInterface.encodeFunctionResult("draws", [
      1_000n, 2_000n, 9n, seed, 10n, 100n, 1, 0, word(0), 0n, ZERO, 3, 100n, 0n, 0n,
    ]);
  }
  if (data.startsWith(managerInterface.getFunction("vault").selector)) {
    return managerInterface.encodeFunctionResult("vault", [addresses.prizeVault]);
  }
  if (data.startsWith(managerInterface.getFunction("twabController").selector)) {
    return managerInterface.encodeFunctionResult("twabController", [addresses.twabController]);
  }
  if (data.startsWith(managerInterface.getFunction("drawFeeRecipientCount").selector)) {
    return managerInterface.encodeFunctionResult("drawFeeRecipientCount", [0n]);
  }
  if (data.startsWith(managerInterface.getFunction("payoutToken").selector)) {
    return managerInterface.encodeFunctionResult("payoutToken", [addresses.payoutToken]);
  }
  if (data.startsWith(managerInterface.getFunction("drawRewardLegCount").selector)) {
    return managerInterface.encodeFunctionResult("drawRewardLegCount", [0n]);
  }
  if (data.startsWith(twabInterface.getFunction("getTwabBetween").selector)) {
    return twabInterface.encodeFunctionResult("getTwabBetween", [10n]);
  }
  throw new Error(`Unexpected eth_call selector ${data.slice(0, 10)}`);
}

function createRpcServer({ logs, redirectStatus, redirectMethod, redirectUrl, counters }) {
  return http.createServer(async (req, res) => {
    const payload = await readJson(req);
    const requests = Array.isArray(payload) ? payload : [payload];
    counters.wireRequests += 1;
    for (const item of requests) counters.methods[item.method] = (counters.methods[item.method] || 0) + 1;
    if (redirectStatus && requests.some((item) => item.method === redirectMethod)) {
      res.writeHead(redirectStatus, { location: redirectUrl });
      res.end();
      return;
    }
    try {
      const responses = requests.map((item) => ({
        jsonrpc: "2.0",
        id: item.id,
        result: resultFor(item.method, item.params || [], logs),
      }));
      json(res, 200, Array.isArray(payload) ? responses : responses[0]);
    } catch (error) {
      json(res, 500, { error: String(error.message || error) });
    }
  });
}

function runQualification(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], { cwd: ROOT, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-qualification-transport-"));
  const logs = buildLogs();
  const destination = { requests: 0 };
  const destinationServer = http.createServer((req, res) => {
    destination.requests += 1;
    json(res, 200, { jsonrpc: "2.0", id: 1, result: "0x8f" });
  });
  const destinationUrl = await listen(destinationServer);
  const counters = () => ({ wireRequests: 0, methods: {} });
  const candidateCounters = counters();
  const referenceCounters = counters();
  const canonicalCounters = counters();
  const candidateServer = createRpcServer({
    logs,
    redirectStatus: options.redirectStatus,
    redirectMethod: options.redirectMethod,
    redirectUrl: destinationUrl,
    counters: candidateCounters,
  });
  const referenceServer = createRpcServer({ logs, counters: referenceCounters });
  const canonicalServer = createRpcServer({ logs, counters: canonicalCounters });
  const [candidateUrl, referenceUrl, canonicalUrl] = await Promise.all([
    listen(candidateServer), listen(referenceServer), listen(canonicalServer),
  ]);

  const admission = { reserves: 0 };
  const admissionServer = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    const body = await readJson(req);
    if (req.url.endsWith("/start")) {
      json(res, 200, { qualificationId: body.qualificationId, usedRequests: admission.reserves, accountRequestCap: 500 });
      return;
    }
    if (!req.url.endsWith("/reserve")) {
      json(res, 404, { error: "not found" });
      return;
    }
    if (options.denyAfter != null && admission.reserves >= options.denyAfter) {
      json(res, 429, { error: "qualification request cap exhausted" });
      return;
    }
    admission.reserves += Number(body.count);
    json(res, 200, { qualificationId: body.qualificationId, usedRequests: admission.reserves, accountRequestCap: 500 });
  });
  const admissionUrl = `${await listen(admissionServer)}/admission/provider-qualification`;

  const deploymentRole = "EverDraw V5 mainnet beta - ADR-0045 draw-manager activation";
  const deploymentFile = path.join(dir, "deployment.json");
  fs.writeFileSync(deploymentFile, JSON.stringify({ contracts: [{
    role: deploymentRole,
    startBlock: 100,
    addresses: {
      prizeVault: addresses.prizeVault,
      drawManager: addresses.drawManager,
      claimManager: addresses.claimManager,
      twabController: addresses.twabController,
    },
  }] }));
  const expectedInput = {
    algoVersion: "everdraw-v5-draw-algorithm/3",
    chainId: "143",
    claimManager: addresses.claimManager,
    drawId: "1",
    drawManager: addresses.drawManager,
    vault: addresses.prizeVault,
    twabController: addresses.twabController,
    seed,
    seedBlock: 100,
    periodStart: "1000",
    periodEnd: "2000",
    totalTwab: "10",
    totalPayout: "100",
    prizeLegs: [{ token: addresses.payoutToken, amount: "100", feeAmount: "0" }],
    feeRecipients: [],
    tierBps: [10000],
    accounts: [{ address: addresses.participant, twab: "10" }],
  };
  const kinds = ["seed", "proposal", "finalization", "mint", "transfer", "burn"];
  const inputFile = path.join(dir, "input.json");
  fs.writeFileSync(inputFile, JSON.stringify({
    schemaVersion: 2,
    chainId: "143",
    deploymentRole,
    finalBlock: 101,
    finalBlockHash: finalHash,
    knownEvents: kinds.map((kind, index) => ({
      kind,
      txHash: logs[index].transactionHash,
      logIndex: index,
      blockNumber: 100,
      blockHash: word(100),
      address: logs[index].address,
      topic0: logs[index].topics[0],
    })),
    draws: [{ drawId: "1", seedBlock: 100, root: compute(expectedInput).root, totalTwab: "10" }],
  }));
  const identity = "0x" + createHash("sha256")
    .update(JSON.stringify([candidateUrl, referenceUrl, canonicalUrl].map((url) => new URL(url).origin.toLowerCase())))
    .digest("hex");
  const outputFile = path.join(dir, "output.json");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const env = {
    RPC_QUALIFY_CANDIDATE_URL: candidateUrl,
    RPC_QUALIFY_REFERENCE_URL: referenceUrl,
    RPC_QUALIFY_CANONICAL_URL: canonicalUrl,
    RPC_QUALIFY_ADMISSION_URL: admissionUrl,
    RPC_QUALIFY_ADMISSION_TOKEN: TOKEN,
    RPC_QUALIFY_PROVIDER_IDENTITY: identity,
    RPC_QUALIFY_APPROVED_COMMIT: head,
    RPC_QUALIFY_ID: "local-reconstruction-fixture",
    RPC_QUALIFY_EVIDENCE_INPUT_FILE: inputFile,
    RPC_QUALIFY_OUTPUT_FILE: outputFile,
    RPC_QUALIFY_LOG_RANGE: "1000",
    RPC_QUALIFY_MAX_REQUESTS: "500",
    RPC_QUALIFY_MIN_REQUEST_INTERVAL_MS: "0",
    RPC_QUALIFY_TIMEOUT_MS: "2000",
    DEPLOYMENT_FILE: deploymentFile,
  };
  t.after(async () => {
    await Promise.all([
      close(candidateServer), close(referenceServer), close(canonicalServer), close(admissionServer), close(destinationServer),
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { env, outputFile, admission, destination, candidateCounters };
}

test("complete local qualification reconstructs the historical TWAB and root through admitted providers", async (t) => {
  const f = await fixture(t);
  const result = await runQualification(f.env);
  assert.equal(result.code, 0, result.stderr);
  const evidence = JSON.parse(fs.readFileSync(f.outputFile, "utf8"));
  assert.equal(evidence.status, "qualified");
  assert.equal(evidence.reconstructedDraws.length, 1);
  assert.equal(evidence.reconstructedDraws[0].totalTwab, "10");
  assert.ok(f.candidateCounters.methods.eth_call > 0);
  assert.equal(f.admission.reserves, evidence.requestCount);
});

test("exhausted admission prevents historical eth_call from reaching upstream", async (t) => {
  const f = await fixture(t, { denyAfter: 33 });
  const result = await runQualification(f.env);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Qualification admission refused/);
  assert.equal(f.candidateCounters.methods.eth_call || 0, 0);
  assert.equal(f.admission.reserves, 33);
});

for (const status of [307, 308]) {
  test(`raw qualification transport refuses HTTP ${status} without contacting the destination`, async (t) => {
    const f = await fixture(t, { redirectStatus: status, redirectMethod: "eth_chainId" });
    const result = await runQualification(f.env);
    assert.notEqual(result.code, 0);
    assert.equal(f.destination.requests, 0);
    assert.equal(f.admission.reserves, 6, "initial concurrent requests are admitted once each");
  });
}

for (const status of [301, 302, 307, 308]) {
  test(`ethers qualification transport refuses HTTP ${status} without an unreserved second hop`, async (t) => {
    const f = await fixture(t, { redirectStatus: status, redirectMethod: "eth_call" });
    const result = await runQualification(f.env);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Qualification RPC redirect refused/);
    assert.equal(f.destination.requests, 0);
    assert.ok(f.admission.reserves > 33, "historical request was durably admitted before its sole wire attempt");
  });
}

test("QualificationProvider reserves every batch item and denial prevents the wire request", async (t) => {
  const counters = { wireRequests: 0, methods: {} };
  const server = createRpcServer({ logs: [], counters });
  const url = await listen(server);
  t.after(() => close(server));
  let reservations = 0;
  const provider = new QualificationProvider(url, async () => { reservations += 1; });
  t.after(() => provider.destroy());
  const payload = [
    { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
  ];
  const response = await provider._send(payload);
  assert.equal(reservations, 2);
  assert.equal(counters.wireRequests, 1);
  assert.equal(response.length, 2);

  const denied = new QualificationProvider(url, async () => { throw new Error("admission denied"); });
  t.after(() => denied.destroy());
  await assert.rejects(() => denied._send(payload), /admission denied/);
  assert.equal(counters.wireRequests, 1);
});
