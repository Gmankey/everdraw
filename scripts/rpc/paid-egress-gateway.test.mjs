import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BudgetLedger, initializeBudgetState } from "./paid-egress-ledger.mjs";
import { assertSingleWriterLease, createGatewayServer, validateGatewayTokens } from "./paid-egress-gateway.mjs";
import { assertRpcIncidentPolicy } from "./incident-policy.mjs";

function runWorker(source) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: "ignore" });
    child.on("exit", (code) => resolve(code));
  });
}

function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-rpc-budget-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configFile = path.join(dir, "config.json");
  const stateFile = path.join(dir, "state.json");
  const config = {
    version: 1,
    periodId: "2026-11",
    accountCapCu: 1000,
    criticalReserveCu: 300,
    maxBatchItems: 10,
    roles: {
      routine: { capCu: 1000, critical: false, methods: ["eth_blockNumber"] },
      critical: { capCu: 1000, critical: true, methods: ["eth_sendRawTransaction"] },
    },
    methodCosts: { eth_blockNumber: 100, eth_sendRawTransaction: 100 },
    ...overrides,
  };
  fs.writeFileSync(configFile, JSON.stringify(config));
  initializeBudgetState(configFile, stateFile);
  return { dir, configFile, stateFile, config };
}

test("gateway requires long scoped tokens for every configured role", () => {
  assert.throws(() => validateGatewayTokens({ routine: "short" }, ["routine"]), /too short/);
  assert.throws(() => validateGatewayTokens({}, ["routine"]), /missing/);
  assert.doesNotThrow(() => validateGatewayTokens({ routine: "x".repeat(32) }, ["routine"]));
});

test("durable reservations survive restart and protect the critical reserve", (t) => {
  const f = fixture(t);
  let ledger = new BudgetLedger(f);
  const request = { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] };
  for (let i = 0; i < 7; i++) ledger.reserve("routine", request);
  assert.throws(() => ledger.reserve("routine", request), { code: "RPC_BUDGET_EXHAUSTED" });
  ledger = new BudgetLedger(f);
  assert.equal(ledger.snapshot().usedCu, 700);
  ledger.reserve("critical", { jsonrpc: "2.0", id: 2, method: "eth_sendRawTransaction", params: ["0x"] });
  assert.equal(ledger.snapshot().usedCu, 800);
});

test("unknown methods, logs, missing state, corrupt state and lock contention fail closed", (t) => {
  const f = fixture(t);
  const ledger = new BudgetLedger(f);
  assert.throws(() => ledger.reserve("routine", { method: "eth_getLogs" }), { code: "RPC_METHOD_DENIED" });
  assert.throws(() => ledger.reserve("routine", { method: "unknown" }), { code: "RPC_METHOD_DENIED" });
  fs.writeFileSync(f.stateFile + ".lock", "occupied");
  assert.throws(() => ledger.reserve("routine", { method: "eth_blockNumber" }), { code: "RPC_BUDGET_LOCKED" });
  fs.unlinkSync(f.stateFile + ".lock");
  fs.writeFileSync(f.stateFile, "{bad");
  assert.throws(() => new BudgetLedger(f), { code: "RPC_BUDGET_STATE_UNAVAILABLE" });
  fs.unlinkSync(f.stateFile);
  assert.throws(() => new BudgetLedger(f), { code: "RPC_BUDGET_STATE_UNAVAILABLE" });
});

test("structurally corrupt counters, roles and reservations fail closed", (t) => {
  const mutations = [
    (state) => { state.usedCu = -1; },
    (state) => { state.usedCu = "0"; },
    (state) => { delete state.roles.routine; },
    (state) => { state.roles.routine.usedCu = 1; },
    (state) => { state.roles.routine.requests = Number.NaN; },
    (state) => { state.reservations = [{ id: "x", role: "routine", costCu: 100, methods: { eth_blockNumber: 2 }, reservedAt: new Date().toISOString() }]; },
    (state) => { state.latched = false; state.latchReason = "stale"; },
  ];
  for (const mutate of mutations) {
    const f = fixture(t);
    const state = JSON.parse(fs.readFileSync(f.stateFile, "utf8"));
    mutate(state);
    fs.writeFileSync(f.stateFile, JSON.stringify(state));
    assert.throws(() => new BudgetLedger(f), { code: "RPC_BUDGET_STATE_UNAVAILABLE" });
  }
});

test("same-period reset and redundant unlatch are rejected", (t) => {
  const f = fixture(t);
  const ledger = new BudgetLedger(f);
  const snapshot = ledger.snapshot();
  assert.throws(
    () => initializeBudgetState(f.configFile, f.stateFile, { replace: true, expectedHash: snapshot.stateHash }),
    { code: "RPC_BUDGET_STATE_UNAVAILABLE" },
  );
  assert.throws(() => ledger.unlatch(snapshot.stateHash), { code: "RPC_BUDGET_STATE_UNAVAILABLE" });
  const latched = ledger.latch("test incident");
  const cleared = ledger.unlatch(latched.stateHash);
  assert.equal(cleared.latched, false);
  assert.throws(() => ledger.unlatch(cleared.stateHash), { code: "RPC_BUDGET_STATE_UNAVAILABLE" });
});

test("durable single-writer lease rejects a second gateway instance", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-rpc-writer-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const leaseFile = path.join(dir, "writer.json");
  assert.equal(assertSingleWriterLease({ leaseFile, instanceId: "machine-a" }).instanceId, "machine-a");
  assert.equal(assertSingleWriterLease({ leaseFile, instanceId: "machine-a" }).instanceId, "machine-a");
  assert.throws(() => assertSingleWriterLease({ leaseFile, instanceId: "machine-b" }), /another instance/);
  fs.writeFileSync(leaseFile, "{bad");
  assert.throws(() => assertSingleWriterLease({ leaseFile, instanceId: "machine-a" }), /lease is corrupt/);
});

test("multi-process reservations and admin changes cannot lose ledger updates", async (t) => {
  const f = fixture(t, { accountCapCu: 5000, roles: {
    routine: { capCu: 5000, critical: false, methods: ["eth_blockNumber"] },
    critical: { capCu: 5000, critical: true, methods: ["eth_sendRawTransaction"] },
  } });
  const moduleUrl = new URL("./paid-egress-ledger.mjs", import.meta.url).href;
  const options = JSON.stringify({ configFile: f.configFile, stateFile: f.stateFile });
  const reserveSource = `
    import { BudgetLedger } from ${JSON.stringify(moduleUrl)};
    try {
      new BudgetLedger(${options}).reserve("routine", { method: "eth_blockNumber" });
      process.exit(0);
    } catch (error) {
      process.exit(error.code === "RPC_BUDGET_LOCKED" ? 2 : 3);
    }
  `;
  const results = await Promise.all(Array.from({ length: 12 }, () => runWorker(reserveSource)));
  assert.ok(results.includes(0));
  assert.ok(results.every((code) => code === 0 || code === 2));
  let ledger = new BudgetLedger(f);
  assert.equal(ledger.snapshot().usedCu, results.filter((code) => code === 0).length * 100);

  const latched = ledger.latch("operator test");
  const unlatchSource = `
    import { BudgetLedger } from ${JSON.stringify(moduleUrl)};
    try {
      new BudgetLedger(${options}).unlatch(${JSON.stringify(latched.stateHash)});
      process.exit(0);
    } catch (error) {
      process.exit(error.code === "RPC_BUDGET_LOCKED" ? 2 : 3);
    }
  `;
  const [adminResult, reservationResult] = await Promise.all([
    runWorker(unlatchSource),
    runWorker(reserveSource),
  ]);
  assert.ok([0, 2].includes(adminResult));
  assert.ok([0, 2, 3].includes(reservationResult));
  ledger = new BudgetLedger(f);
  const afterRace = ledger.snapshot();
  if (adminResult === 2) ledger.unlatch(afterRace.stateHash);
  assert.equal(new BudgetLedger(f).snapshot().latched, false);
});

test("every batch item is charged before one outbound attempt", async (t) => {
  const f = fixture(t);
  const ledger = new BudgetLedger(f);
  let attempts = 0;
  const upstream = http.createServer(async (req, res) => {
    for await (const _ of req) {}
    attempts++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([
      { jsonrpc: "2.0", id: 1, result: "0x1" },
      { jsonrpc: "2.0", id: 2, result: "0x1" },
    ]));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const gateway = createGatewayServer({
    upstreamUrl: `http://127.0.0.1:${upstream.address().port}`,
    tokens: { routine: "secret" },
    ledger,
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${gateway.address().port}/rpc/routine`, {
    method: "POST",
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
    ]),
  });
  assert.equal(response.status, 200);
  assert.equal(attempts, 1);
  assert.equal(ledger.snapshot().usedCu, 200);
  assert.equal(ledger.snapshot().roles.routine.requests, 2);
});

test("quota response durably latches future traffic", async (t) => {
  const f = fixture(t);
  const ledger = new BudgetLedger(f);
  const gateway = createGatewayServer({
    upstreamUrl: "https://upstream.invalid",
    tokens: { routine: "secret" },
    ledger,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 }),
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  const call = () => fetch(`http://127.0.0.1:${gateway.address().port}/rpc/routine`, {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  assert.equal((await call()).status, 429);
  assert.equal(ledger.snapshot().latched, true);
  assert.equal((await call()).status, 503);
});

test("gateway refuses redirects without following a second hop", async (t) => {
  const f = fixture(t);
  let attempts = 0;
  const gateway = createGatewayServer({
    upstreamUrl: "https://upstream.invalid",
    tokens: { routine: "secret" },
    ledger: new BudgetLedger(f),
    fetchImpl: async (_url, options) => {
      attempts++;
      assert.equal(options.redirect, "manual");
      return new Response(null, { status: 302, headers: { location: "https://second-hop.invalid" } });
    },
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${gateway.address().port}/rpc/routine`, {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "RPC_UPSTREAM_REDIRECT_DENIED");
  assert.equal(attempts, 1);
});

test("gateway timeout covers a stalled response body", async (t) => {
  const f = fixture(t);
  const gateway = createGatewayServer({
    upstreamUrl: "https://upstream.invalid",
    tokens: { routine: "secret" },
    ledger: new BudgetLedger(f),
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    }), { status: 200 }),
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${gateway.address().port}/rpc/routine`, {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "RPC_UPSTREAM_TIMEOUT");
});

test("gateway bounds upstream response bodies", async (t) => {
  const f = fixture(t);
  const gateway = createGatewayServer({
    upstreamUrl: "https://upstream.invalid",
    tokens: { routine: "secret" },
    ledger: new BudgetLedger(f),
    responseLimit: 8,
    fetchImpl: async () => new Response("0123456789", { status: 200 }),
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${gateway.address().port}/rpc/routine`, {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "RPC_UPSTREAM_RESPONSE_TOO_LARGE");
});

test("direct paid endpoints are rejected before transport", () => {
  assert.throws(
    () => assertRpcIncidentPolicy("https://monad-mainnet.g.alchemy.com/v2/secret"),
    { code: "RPC_POLICY_DENIED" },
  );
  assert.doesNotThrow(() => assertRpcIncidentPolicy("https://rpc2.monad.xyz"));
});
