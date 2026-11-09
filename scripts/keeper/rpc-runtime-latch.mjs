import fs from "node:fs";
import path from "node:path";

export function paidRpcStopReason(line) {
  const text = String(line).toLowerCase();
  if (/rpc_budget_(exhausted|latched|state_unavailable|locked)/.test(text)) return "paid-rpc-budget";
  if (/quota exceeded|monthly capacity|compute unit limit/.test(text)) return "paid-provider-quota";
  return "";
}

export function writeRuntimeLatch(file, reason, detail) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const state = {
    version: 1,
    reason,
    detail: String(detail).slice(0, 500),
    createdAt: new Date().toISOString(),
    recovery: "Requires auditor-approved operator removal; never cleared automatically.",
  };
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, file);
  return state;
}
