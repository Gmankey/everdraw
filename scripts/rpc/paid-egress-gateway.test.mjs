import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BudgetLedger, initializeBudgetState } from "./paid-egress-ledger.mjs";
import { createGatewayServer } from "./paid-egress-gateway.mjs";
import { assertRpcIncidentPolicy } from "./incident-policy.mjs";

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

test("direct paid endpoints are rejected before transport", () => {
  assert.throws(
    () => assertRpcIncidentPolicy("https://monad-mainnet.g.alchemy.com/v2/secret"),
    { code: "RPC_POLICY_DENIED" },
  );
  assert.doesNotThrow(() => assertRpcIncidentPolicy("https://rpc2.monad.xyz"));
});
