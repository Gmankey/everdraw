import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { canCheckpointBatch, proposalCoverageFailure, shouldEnforceLiveWindow, withRpcTimeout } from "./watch-root-proposals.mjs";
import { isRangeLimitError, isTransientError, retryTransient } from "./write-watch-inputs.mjs";

test("provider startup invalid JSON is retryable", async () => {
  let calls = 0;
  const result = await retryTransient(
    async () => {
      calls++;
      if (calls < 3) throw new Error("response body is not valid JSON");
      return 123;
    },
    "test provider",
    { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  );

  assert.equal(result, 123);
  assert.equal(calls, 3);
  assert.equal(isTransientError(new Error("failed to detect network")), true);
});

test("CU rate limits back off instead of recursively splitting the block range", () => {
  const err = new Error("could not coalesce error");
  err.error = { message: "compute units per second capacity exceeded; too many requests" };

  assert.equal(isTransientError(err), true);
  assert.equal(isRangeLimitError(err), false);
  assert.equal(isRangeLimitError(new Error("eth_getLogs block range limited to 100 blocks")), true);
  assert.equal(isTransientError(Object.assign(new Error("fallback timed out"), { error: { message: "opaque provider error" } })), true);
});

test("deterministic errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        calls++;
        throw new Error("TWAB mismatch");
      },
      "test deterministic",
      { attempts: 6, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
    ),
    /TWAB mismatch/,
  );
  assert.equal(calls, 1);
});

test("proposal coverage requires five minutes of veto time", () => {
  assert.equal(
    proposalCoverageFailure({ challengeEndsAt: 1_000, observedAt: 600, minRemainingSec: 300 }),
    undefined,
  );
  assert.match(
    proposalCoverageFailure({ challengeEndsAt: 1_000, observedAt: 701, minRemainingSec: 300 }),
    /only 299 seconds remained/,
  );
});
test("bootstrap timing is not treated as live coverage and only root mismatches pin the cursor", () => {
  assert.equal(shouldEnforceLiveWindow({ lastScannedBlock: 123 }), false);
  assert.equal(shouldEnforceLiveWindow({ lastScannedBlock: 123, liveMonitoring: false }), false);
  assert.equal(shouldEnforceLiveWindow({ lastScannedBlock: 123, liveMonitoring: true }), true);
  assert.equal(canCheckpointBatch(0), true);
  assert.equal(canCheckpointBatch(1), false);
});

test("current RPC calls have a bounded timeout", async () => {
  await assert.rejects(
    withRpcTimeout(new Promise(() => {}), "watcher chain head", 5),
    /watcher chain head timed out after 5ms/,
  );
  await assert.rejects(
    Promise.resolve().then(() => withRpcTimeout(Promise.resolve(1), "invalid", 0)),
    /WATCHER_HEAD_RPC_TIMEOUT_MS must be a positive integer/,
  );
});


test("workflow uses configured logs RPC and a five-minute cadence", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/v5-watcher.yml", import.meta.url), "utf8");
  const watcher = fs.readFileSync(new URL("./watch-root-proposals.mjs", import.meta.url), "utf8");
  assert.match(workflow, /cron: "\*\/5 \* \* \* \*"/);
  assert.match(workflow, /secrets\.V5_WATCHER_UAT_LOGS_RPC_URL \|\| secrets\.V5_WATCHER_UAT_RPC_URL/);
  assert.doesNotMatch(workflow, /WATCHER_LOGS_RPC_URL: https:\/\/testnet-rpc\.monad\.xyz/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /WATCHER_HEAD_RPC_URL: https:\/\/testnet-rpc\.monad\.xyz/);
  assert.match(workflow, /WATCHER_HEAD_RPC_TIMEOUT_MS: "10000"/);
  assert.match(watcher, /buildDrawInput\(\{\s*provider,/);
  assert.match(watcher, /headProvider\.getBlockNumber\(\)/);
  assert.match(watcher, /shouldEnforceLiveWindow\(state\)/);
  assert.match(watcher, /canCheckpointBatch\(rootMismatches\.length\)/);
  assert.match(watcher, /liveMonitoring: true/);
  assert.match(workflow, /WATCHER_JOB_DURATION_SEC: "3000"/);
  assert.match(workflow, /WATCHER_POLL_INTERVAL_SEC: "60"/);
  assert.match(workflow, /WATCHER_MAX_STALE_SUCCESS_SEC: "600"/);
  assert.match(workflow, /while \(\( SECONDS < deadline \)\)/);
  assert.match(workflow, /WATCHER_CYCLE_TIMEOUT_SEC: "480"/);
  assert.match(workflow, /WATCHER_SHUTDOWN_RESERVE_SEC: "180"/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=15s/);
  assert.match(workflow, /SECONDS - last_success > WATCHER_MAX_STALE_SUCCESS_SEC/);
});

