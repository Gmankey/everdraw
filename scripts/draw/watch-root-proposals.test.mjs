import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { proposalCoverageFailure } from "./watch-root-proposals.mjs";
import { isTransientError, retryTransient } from "./write-watch-inputs.mjs";

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

test("workflow uses configured logs RPC and a five-minute cadence", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/v5-watcher.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron: "\*\/5 \* \* \* \*"/);
  assert.match(workflow, /secrets\.V5_WATCHER_UAT_LOGS_RPC_URL \|\| secrets\.V5_WATCHER_UAT_RPC_URL/);
  assert.doesNotMatch(workflow, /WATCHER_LOGS_RPC_URL: https:\/\/testnet-rpc\.monad\.xyz/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(fs.readFileSync(new URL("./watch-root-proposals.mjs", import.meta.url), "utf8"), /if \(coverageFailures\.length === 0\)/);
});

