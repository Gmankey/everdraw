#!/usr/bin/env node
import fs from "node:fs";
import { BudgetLedger, initializeBudgetState, stateHash } from "./paid-egress-ledger.mjs";

const configFile = process.env.RPC_BUDGET_CONFIG_FILE || "scripts/rpc/paid-egress-budget.mainnet.json";
const stateFile = process.env.RPC_BUDGET_STATE_FILE || "rpc-budget-state.json";
const command = process.argv[2];

function config() {
  return JSON.parse(fs.readFileSync(configFile, "utf8"));
}
function requireConfirmation(expected) {
  if (process.env.RPC_BUDGET_CONFIRM !== expected) throw new Error(`Set RPC_BUDGET_CONFIRM exactly to: ${expected}`);
}

if (command === "init") {
  const periodId = config().periodId;
  requireConfirmation(`INITIALIZE ${periodId}`);
  console.log(JSON.stringify(initializeBudgetState(configFile, stateFile), null, 2));
} else if (command === "replace-period") {
  const expectedHash = process.env.RPC_BUDGET_EXPECTED_STATE_HASH || "";
  const periodId = config().periodId;
  requireConfirmation(`REPLACE ${periodId} ${expectedHash}`);
  console.log(JSON.stringify(initializeBudgetState(configFile, stateFile, { replace: true, expectedHash }), null, 2));
} else if (command === "status") {
  console.log(JSON.stringify(new BudgetLedger({ configFile, stateFile }).snapshot(), null, 2));
} else if (command === "unlatch") {
  const ledger = new BudgetLedger({ configFile, stateFile });
  const current = ledger.snapshot();
  const expectedHash = process.env.RPC_BUDGET_EXPECTED_STATE_HASH || "";
  if (current.stateHash !== expectedHash) throw new Error("RPC budget state hash mismatch");
  requireConfirmation(`UNLATCH ${current.periodId} ${expectedHash}`);
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.latched = false;
  state.latchReason = "";
  state.updatedAt = new Date().toISOString();
  const temp = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, stateFile);
  console.log(JSON.stringify({ stateHash: stateHash(state), state }, null, 2));
} else {
  throw new Error("Usage: rpc-budget-admin.mjs <init|replace-period|status|unlatch>");
}
