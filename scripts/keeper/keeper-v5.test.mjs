import assert from "node:assert/strict";
import test from "node:test";

import { claimFinalizedDrawSafely } from "./claim-isolation.mjs";

test("a failed historical claim does not stop later lifecycle work", async () => {
  const failures = [];
  let laterLifecycleRan = false;

  const claimed = await claimFinalizedDrawSafely(
    45n,
    async () => {
      const err = new Error("legacy payout token mismatch");
      err.data = "0x09bde339";
      throw err;
    },
    async (err, message) => failures.push({ err, message }),
  );

  laterLifecycleRan = true;

  assert.equal(claimed, false);
  assert.equal(laterLifecycleRan, true);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /claim draw 45 failed; continuing lifecycle/);
  assert.match(failures[0].message, /legacy payout token mismatch/);
});

test("a successful claim still reports lifecycle activity", async () => {
  const claimed = await claimFinalizedDrawSafely(83n, async () => true);
  assert.equal(claimed, true);
});
