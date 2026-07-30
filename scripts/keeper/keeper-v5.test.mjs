import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { claimDrawIds, firstRecentDrawId } from "../keeper-v5.js";
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
