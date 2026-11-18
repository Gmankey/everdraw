import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BudgetLedger, initializeBudgetState } from "./paid-egress-ledger.mjs";
import { createGatewayServer } from "./paid-egress-gateway.mjs";
import { QualificationAdmissionLedger, initializeQualificationAdmission } from "./qualification-admission-ledger.mjs";

const providerIdentity = "0x" + "12".repeat(32);
const sourceCommit = "ab".repeat(20);

function fixture(t, cooldownSec = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-qualification-admission-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const policyFile = path.join(dir, "policy.json");
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(policyFile, JSON.stringify({ version: 1, periodId: "2026-11", providerIdentity, accountRequestCap: 5, attemptRequestCap: 3, cooldownSec }));
  initializeQualificationAdmission(policyFile, stateFile);
  return { dir, policyFile, stateFile };
}

test("qualification admission fails closed on a cold runner or missing authoritative state", (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.stateFile);
  assert.throws(() => new QualificationAdmissionLedger(f), { code: "RPC_QUALIFICATION_ADMISSION_UNAVAILABLE" });
});

test("reservations survive termination and identical IDs resume without resetting usage", (t) => {
  const f = fixture(t);
  let ledger = new QualificationAdmissionLedger(f);
  assert.equal(ledger.start({ qualificationId: "audit-1", sourceCommit, providerIdentity }).resumed, false);
  ledger.reserve("audit-1");
  ledger.reserve("audit-1");

  ledger = new QualificationAdmissionLedger(f);
  const resumed = ledger.start({ qualificationId: "audit-1", sourceCommit, providerIdentity });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.usedRequests, 2);
  assert.equal(ledger.reserve("audit-1").attemptRequests, 3);
  assert.throws(() => ledger.reserve("audit-1"), /attempt request cap/);
  assert.throws(() => ledger.start({ qualificationId: "audit-1", sourceCommit: "cd".repeat(20), providerIdentity }), /different reviewed inputs/);
  ledger.start({ qualificationId: "audit-2", sourceCommit, providerIdentity });
  ledger.reserve("audit-2", 2);
  assert.throws(() => ledger.reserve("audit-2"), /provider-period request cap/);
});

test("new qualification IDs obey cooldown and remaining aggregate allowance", (t) => {
  const f = fixture(t, 86400);
  const ledger = new QualificationAdmissionLedger(f);
  ledger.start({ qualificationId: "audit-1", sourceCommit, providerIdentity });
  ledger.reserve("audit-1", 2);
  assert.throws(() => ledger.start({ qualificationId: "audit-2", sourceCommit, providerIdentity }), /cooldown/);
});

test("gateway admission reserves durably before qualification upstream work", async (t) => {
  const f = fixture(t);
  const budgetConfigFile = path.join(f.dir, "budget-config.json");
  const budgetStateFile = path.join(f.dir, "budget-state.json");
  fs.writeFileSync(budgetConfigFile, JSON.stringify({
    version: 1,
    periodId: "2026-11",
    accountCapCu: 100,
    criticalReserveCu: 0,
    maxBatchItems: 1,
    roles: { routine: { capCu: 100, critical: false, methods: ["eth_blockNumber"] } },
    methodCosts: { eth_blockNumber: 1 },
  }));
  initializeBudgetState(budgetConfigFile, budgetStateFile);
  const admission = new QualificationAdmissionLedger(f);
  const token = "qualification-token-with-at-least-32-characters";
  const gateway = createGatewayServer({
    upstreamUrl: "https://unused.invalid",
    tokens: { routine: "routine-token-with-at-least-32-chars" },
    ledger: new BudgetLedger({ configFile: budgetConfigFile, stateFile: budgetStateFile }),
    qualificationAdmission: admission,
    qualificationToken: token,
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  const base = `http://127.0.0.1:${gateway.address().port}/admission/provider-qualification`;
  const post = (action, body, bearer = token) => fetch(`${base}/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal((await post("start", { qualificationId: "audit-1", sourceCommit, providerIdentity })).status, 200);
  assert.equal((await post("reserve", { qualificationId: "audit-1", count: 1 })).status, 200);
  assert.equal(new QualificationAdmissionLedger(f).snapshot().usedRequests, 1);
  assert.equal((await post("reserve", { qualificationId: "audit-1", count: 1 }, "wrong-token-with-at-least-32-characters")).status, 401);
});
