import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CountingJsonRpcProvider,
  assertWriteRpcConfiguration,
  claimDrawIds,
  firstRecentDrawId,
  rpcUsageSnapshot,
  syncParticipantEventCache,
  validateWriteProvider,
} from "../keeper-v5.js";
import { BudgetLedger, initializeBudgetState } from "../rpc/paid-egress-ledger.mjs";
import { createGatewayServer } from "../rpc/paid-egress-gateway.mjs";
import {
  ClaimRetryState,
  claimFinalizedDrawSafely,
  claimStateKey,
  terminalClaimError,
  reachedTransientAlertThreshold,
} from "./claim-isolation.mjs";

const DRAW_MANAGER = "0x1111111111111111111111111111111111111111";
const CLAIM_MANAGER = "0x2222222222222222222222222222222222222222";

test("classifies every terminal ClaimManager error by nested selector", () => {
  const cases = [
    ["0x09bde339", "InvalidProof"],
    ["0x3a35c2f9", "DistributionNotFound"],
    ["0x646cf558", "AlreadyClaimed"],
    ["0x89d99da3", "BadLeaf"],
  ];

  for (const [selector, name] of cases) {
    assert.deepEqual(terminalClaimError({ info: { error: { data: selector } } }), { selector, name });
  }
  assert.equal(terminalClaimError(new Error("request timed out")), null);
});


test("transient alert threshold fires once, not on every retry", () => {
  assert.equal(reachedTransientAlertThreshold(1, 3), false);
  assert.equal(reachedTransientAlertThreshold(2, 3), false);
  assert.equal(reachedTransientAlertThreshold(3, 3), true);
  assert.equal(reachedTransientAlertThreshold(4, 3), false);
  assert.throws(() => reachedTransientAlertThreshold(1, 0), /invalid transient claim alert threshold/);
});
test("a terminal historical claim is persisted and skipped after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everdraw-v5-claim-state-"));
  const file = join(dir, "claims.json");
  const state = new ClaimRetryState(file);
  const key = claimStateKey(DRAW_MANAGER, CLAIM_MANAGER, 45n);
  let terminalNoticeCount = 0;

  const claimed = await claimFinalizedDrawSafely(
    45n,
    async () => {
      const err = new Error("execution reverted");
      err.data = "0x09bde339";
      throw err;
    },
    {
      onTerminal: async (_err, terminal, message) => {
        if (state.quarantine(key, { drawId: 45n, ...terminal, message })) {
          terminalNoticeCount += 1;
        }
      },
    },
  );

  assert.equal(claimed, false);
  assert.equal(terminalNoticeCount, 1);
  assert.equal(state.isQuarantined(key), true);
  assert.equal(state.quarantinedCount(), 1);

  const restarted = new ClaimRetryState(file);
  assert.equal(restarted.isQuarantined(key), true);
  assert.equal(
    restarted.quarantine(key, {
      drawId: 45n,
      selector: "0x09bde339",
      name: "InvalidProof",
      message: "duplicate",
    }),
    false,
  );
  assert.equal(terminalNoticeCount, 1);
});

test("transient claim failures remain retryable and clear after success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everdraw-v5-claim-state-"));
  const state = new ClaimRetryState(join(dir, "claims.json"));
  const key = claimStateKey(DRAW_MANAGER, CLAIM_MANAGER, 83n);
  let attempts = 0;

  for (let expected = 1; expected <= 2; expected += 1) {
    const claimed = await claimFinalizedDrawSafely(
      83n,
      async () => {
        attempts += 1;
        throw new Error("RPC request timed out");
      },
      {
        onTransient: async (_err, message) => {
          const retry = state.recordTransientFailure(key, { drawId: 83n, message });
          assert.equal(retry.failures, expected);
        },
      },
    );
    assert.equal(claimed, false);
    assert.equal(state.isQuarantined(key), false);
  }

  const claimed = await claimFinalizedDrawSafely(
    83n,
    async () => {
      attempts += 1;
      return true;
    },
    { onSuccess: async () => state.clearTransientFailure(key) },
  );
  assert.equal(claimed, true);
  assert.equal(state.clearTransientFailure(key), false);
  assert.equal(attempts, 3);
});

test("large recent window, not V5_KEEPER_FROM_BLOCK, keeps legacy draw ids eligible", () => {
  const first = firstRecentDrawId(105n, 1000);
  const candidates = claimDrawIds([], first, 105n);
  assert.equal(first, 1n);
  assert.equal(candidates.includes(45n), true);
});

test("a successful claim still reports lifecycle activity", async () => {
  const claimed = await claimFinalizedDrawSafely(83n, async () => true);
  assert.equal(claimed, true);
});

test("keeper wire telemetry counts actual ethers transport calls and errors", async (t) => {
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const part of request) body += part;
    const call = JSON.parse(body);
    const result = call.method === "eth_blockNumber"
      ? { jsonrpc: "2.0", id: call.id, result: "0x2a" }
      : { jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "test failure" } };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const provider = new CountingJsonRpcProvider(
    `http://127.0.0.1:${address.port}`,
    "read-test",
    143,
    { staticNetwork: true, batchMaxCount: 1 },
  );
  t.after(() => provider.destroy());
  const before = rpcUsageSnapshot();
  assert.equal(await provider.getBlockNumber(), 42);
  await assert.rejects(provider.getBalance(DRAW_MANAGER), /test failure/);
  const after = rpcUsageSnapshot();
  assert.equal(
    after.wireCalls["read-test:eth_blockNumber"],
    (before.wireCalls["read-test:eth_blockNumber"] || 0) + 1,
  );
  assert.equal(
    after.wireCalls["read-test:eth_getBalance"],
    (before.wireCalls["read-test:eth_getBalance"] || 0) + 1,
  );
  assert.equal(
    after.wireErrors["read-test:eth_getBalance"],
    (before.wireErrors["read-test:eth_getBalance"] || 0) + 1,
  );
});

test("keeper authenticates through the actual scoped write gateway", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "everdraw-keeper-gateway-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configFile = join(dir, "config.json");
  const stateFile = join(dir, "state.json");
  const methods = [
    "eth_chainId",
    "eth_getTransactionCount",
    "eth_estimateGas",
    "eth_sendRawTransaction",
    "eth_getTransactionReceipt",
  ];
  writeFileSync(configFile, JSON.stringify({
    version: 1,
    periodId: "test",
    accountCapCu: 10000,
    criticalReserveCu: 0,
    maxBatchItems: 10,
    roles: { "keeper-write": { capCu: 10000, critical: true, methods } },
    methodCosts: Object.fromEntries(methods.map((method) => [method, 100])),
  }));
  initializeBudgetState(configFile, stateFile);
  const token = "keeper-test-token-with-at-least-32-characters";
  const upstream = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const call = JSON.parse(raw);
    const results = {
      eth_chainId: "0x8f",
      eth_getTransactionCount: "0x2",
      eth_estimateGas: "0x5208",
      eth_sendRawTransaction: "0x" + "ab".repeat(32),
      eth_getTransactionReceipt: null,
    };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: results[call.method] }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const gateway = createGatewayServer({
    upstreamUrl: `http://127.0.0.1:${upstream.address().port}`,
    tokens: { "keeper-write": token },
    ledger: new BudgetLedger({ configFile, stateFile }),
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  const url = `http://127.0.0.1:${gateway.address().port}/rpc/keeper-write`;
  assertWriteRpcConfiguration({ url, bearerToken: token, expectedChainId: 143n, gatewayHost: "127.0.0.1" });
  const provider = new CountingJsonRpcProvider(url, "write-test", 143, { staticNetwork: true, batchMaxCount: 1 }, 1000, token);
  t.after(() => provider.destroy());
  assert.equal(await validateWriteProvider(provider, 143n), 143n);
  assert.equal(await provider.send("eth_getTransactionCount", [DRAW_MANAGER, "latest"]), "0x2");
  assert.equal(await provider.send("eth_estimateGas", [{ from: DRAW_MANAGER, to: CLAIM_MANAGER }]), "0x5208");
  assert.equal(await provider.send("eth_sendRawTransaction", ["0x01"]), "0x" + "ab".repeat(32));
  assert.equal(await provider.send("eth_getTransactionReceipt", ["0x" + "ab".repeat(32)]), null);
  const snapshot = new BudgetLedger({ configFile, stateFile }).snapshot();
  assert.equal(snapshot.roles["keeper-write"].requests, 5);

  const rejected = new CountingJsonRpcProvider(url, "write-rejected", 143, { staticNetwork: true, batchMaxCount: 1 }, 1000, "wrong-token-with-at-least-32-characters");
  t.after(() => rejected.destroy());
  await assert.rejects(validateWriteProvider(rejected, 143n), /RPC_AUTH_FAILED/);
});

test("managed keeper refuses to start without its required success heartbeat", () => {
  const result = spawnSync(process.execPath, ["-e", "import('./scripts/keeper-v5.js')"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KEEPER_REQUIRE_HEALTHCHECK: "true",
      KEEPER_HEALTHCHECK_URL: "",
    },
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /KEEPER_HEALTHCHECK_URL is required/);
});

test("keeper includes ClaimLeaf.kind in claimMany payloads", () => { const source = readFileSync(new URL("../keeper-v5.js", import.meta.url), "utf8"); assert.equal(source.includes("kind: leaf.kind"), true); });
test("keeper balance health reads use KEEPER_READ_RPC_URL, not the transaction RPC", () => { const source = readFileSync(new URL("../keeper-v5.js", import.meta.url), "utf8"); assert.equal(source.includes("readProvider.getBalance(signer.address)"), true); assert.equal(source.includes("writeProvider.getBalance(signer.address)"), false); });
test("keeper validates scoped gateway authentication before lifecycle reads", () => { const source = readFileSync(new URL("../keeper-v5.js", import.meta.url), "utf8"); const runOnce = source.slice(source.indexOf("async function runOnce"), source.indexOf("async function main")); assert.equal(runOnce.includes("await validateWriteProvider(writeProvider)"), true); });


test("keeper routes historical root reconstruction through the bounded archive provider", () => {
  const source = readFileSync(new URL("../keeper-v5.js", import.meta.url), "utf8");
  assert.match(source, /const ROOT_RPC_URL = process\.env\.KEEPER_ROOT_RPC_URL \|\| READ_RPC_URL/);
  assert.match(source, /buildAndPersistInput\(rootProvider, drawManagerAddress, drawId, fromBlock, eventCache\)/);
  assert.doesNotMatch(source, /buildAndPersistInput\(provider, drawManagerAddress, drawId, fromBlock, eventCache\)/);
});

test("keeper skips archive reconstruction when every registered leaf is already claimed", () => {
  const source = readFileSync(new URL("../keeper-v5.js", import.meta.url), "utf8");
  const maybeClaim = source.slice(source.indexOf("async function maybeClaim"), source.indexOf("async function reconcileLifecycleDraw"));
  const skipIndex = maybeClaim.indexOf("claimedByIndex.every(Boolean)");
  const buildIndex = maybeClaim.indexOf("buildAndPersistInput(rootProvider");
  assert.notEqual(skipIndex, -1);
  assert.notEqual(buildIndex, -1);
  assert.ok(skipIndex < buildIndex);
});

test("mainnet keeper persists reconstructed draw inputs across deployments", () => {
  const manifest = readFileSync(new URL("./fly.v5.mainnet.toml", import.meta.url), "utf8");
  assert.match(manifest, /DRAW_INPUT_DIR = \x22\/data\x22/);
});

test("keeper advances participant discovery during an idle loop", async () => {
  const calls = [];
  const eventCache = {
    async syncParticipants(args) {
      calls.push(args);
    },
  };
  const provider = { name: "read-provider" };

  await syncParticipantEventCache({
    eventCache,
    provider,
    drawManagerAddress: DRAW_MANAGER,
    vaultAddress: "0x3333333333333333333333333333333333333333",
    fromBlock: 100,
    toBlock: 2_100_100,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, provider);
  assert.equal(calls[0].fromBlock, 100);
  assert.equal(calls[0].toBlock, 2_100_100);
});
