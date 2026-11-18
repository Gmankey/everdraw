#!/usr/bin/env node
import fs from "node:fs";
import { QualificationAdmissionLedger, initializeQualificationAdmission } from "./qualification-admission-ledger.mjs";

const policyFile = process.env.RPC_QUALIFICATION_POLICY_FILE || "scripts/rpc/qualification-admission.mainnet.json";
const stateFile = process.env.RPC_QUALIFICATION_STATE_FILE || "qualification-admission-state.json";
const command = process.argv[2];
const policy = () => JSON.parse(fs.readFileSync(policyFile, "utf8"));
const confirm = (expected) => {
  if (process.env.RPC_QUALIFICATION_CONFIRM !== expected) throw new Error(`Set RPC_QUALIFICATION_CONFIRM exactly to: ${expected}`);
};

if (command === "init") {
  confirm(`INITIALIZE ${policy().periodId}`);
  console.log(JSON.stringify(initializeQualificationAdmission(policyFile, stateFile), null, 2));
} else if (command === "replace-period") {
  const expectedHash = process.env.RPC_QUALIFICATION_EXPECTED_STATE_HASH || "";
  confirm(`REPLACE ${policy().periodId} ${expectedHash}`);
  console.log(JSON.stringify(initializeQualificationAdmission(policyFile, stateFile, { replace: true, expectedHash }), null, 2));
} else if (command === "status") {
  console.log(JSON.stringify(new QualificationAdmissionLedger({ policyFile, stateFile }).snapshot(), null, 2));
} else {
  throw new Error("Usage: qualification-admission-admin.mjs <init|replace-period|status>");
}
