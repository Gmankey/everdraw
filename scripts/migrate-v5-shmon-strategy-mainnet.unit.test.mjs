import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("./migrate-v5-shmon-strategy-mainnet.js", import.meta.url),
  "utf8",
);
const verifierSource = fs.readFileSync(
  new URL("./lib/v5-strategy-migration-verifier.mjs", import.meta.url),
  "utf8",
);

test("migration tool is mainnet-pinned and read-only by default", () => {
  assert.match(source, /MAINNET_CHAIN_ID = 143n/);
  assert.match(source, /latestV5Record\(\)/);
  assert.match(source, /process\.argv\.includes\("--deploy"\)/);
  assert.match(source, /process\.argv\.includes\("--verify"\)/);
  assert.match(source, /phase === "committed"/);
  assert.doesNotMatch(source, /readline|readFileSync\([^)]*PRIVATE_KEY|writeFileSync/);
});

test("migration tool authenticates source, runtime, dependencies, and phases", () => {
  assert.match(source, /APPROVED_SHMON = "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c"/);
  assert.match(source, /APPROVED_REPLACEMENT_COMMIT/);
  assert.match(source, /APPROVED_STRATEGY_RUNTIME_CODEHASH/);
  assert.match(source, /loadApprovedStrategyBuild/);
  assert.match(source, /verifyApprovedTarget/);
  assert.match(source, /verifyCommittedSnapshots/);
  assert.match(source, /prequeue\|queued\|committed/);
  assert.match(source, /queueStrategyChange/);
  assert.match(source, /commitStrategyChange/);
  assert.match(source, /cancelStrategyChange/);
  assert.match(verifierSource, /replacement runtime mismatch/);
  assert.match(verifierSource, /source does not match worktree/);
  assert.match(verifierSource, /runtime codehash mismatch/);
  assert.match(verifierSource, /replacement vault mismatch/);
  assert.match(verifierSource, /Share conservation failed/);
  assert.match(verifierSource, /Native dust conservation failed/);
});
