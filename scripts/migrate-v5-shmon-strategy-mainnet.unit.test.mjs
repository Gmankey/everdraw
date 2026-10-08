import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("./migrate-v5-shmon-strategy-mainnet.js", import.meta.url),
  "utf8",
);

test("migration tool is mainnet-pinned and read-only by default", () => {
  assert.match(source, /MAINNET_CHAIN_ID = 143n/);
  assert.match(source, /latestV5Record\(\)/);
  assert.match(source, /process\.argv\.includes\("--deploy"\)/);
  assert.match(source, /process\.argv\.includes\("--verify"\)/);
  assert.match(source, /mode: DEPLOY_MODE \? "deploy" : VERIFY_MODE \? "verify" : "plan"/);
  assert.doesNotMatch(source, /readline|readFileSync\([^)]*PRIVATE_KEY|writeFileSync/);
});

test("migration tool pins dependencies and emits governed calldata", () => {
  assert.match(source, /APPROVED_SHMON = "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c"/);
  assert.match(source, /queueStrategyChange/);
  assert.match(source, /commitStrategyChange/);
  assert.match(source, /cancelStrategyChange/);
  assert.match(source, /replacement vault mismatch/);
  assert.match(source, /old strategy still holds/);
});
