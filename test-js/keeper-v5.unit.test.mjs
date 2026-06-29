import test from "node:test";
import assert from "node:assert/strict";
import { firstRecentDrawId } from "../scripts/keeper-v5.js";

test("firstRecentDrawId keeps the configured recent claim window", () => {
  assert.equal(firstRecentDrawId(0n, 5), 1n);
  assert.equal(firstRecentDrawId(1n, 5), 1n);
  assert.equal(firstRecentDrawId(5n, 5), 1n);
  assert.equal(firstRecentDrawId(6n, 5), 2n);
  assert.equal(firstRecentDrawId(12n, 5), 8n);
});

test("firstRecentDrawId rejects invalid windows", () => {
  assert.throws(() => firstRecentDrawId(12n, 0), /Invalid recent draw window/);
});
