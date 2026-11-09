import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { paidRpcStopReason, writeRuntimeLatch } from "./rpc-runtime-latch.mjs";

test("terminal paid-RPC failures trigger the persistent stop class", () => {
  for (const line of [
    "error code=RPC_BUDGET_EXHAUSTED",
    "RPC_BUDGET_LATCHED",
    "RPC_BUDGET_STATE_UNAVAILABLE",
    "monthly capacity exceeded",
    "compute unit limit reached",
    "quota exceeded",
  ]) assert.ok(paidRpcStopReason(line), line);
  assert.equal(paidRpcStopReason("temporary public RPC timeout"), "");
});

test("runtime latch is durable and never self-expires", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-rpc-latch-"));
  try {
    const file = path.join(dir, "latch.json");
    const written = writeRuntimeLatch(file, "paid-rpc-budget", "budget exhausted");
    const restored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(restored.reason, written.reason);
    assert.match(restored.recovery, /never cleared automatically/);
    assert.equal("expiresAt" in restored, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
