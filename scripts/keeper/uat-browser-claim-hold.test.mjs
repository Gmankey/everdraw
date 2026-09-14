import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { UatBrowserClaimHold } from "./uat-browser-claim-hold.mjs";
const manager = "0x" + "ab".repeat(20);
const cm = "0x" + "cd".repeat(20);
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-claim-hold-"));
  return { dir, config: { armedManager: manager, chainId: 10143n,
    drawManagerAddress: manager, claimManagerAddress: cm, file: path.join(dir, "hold.json") } };
}
test("disabled by default including mainnet, no checkpoint read or write", () => {
  assert.equal(new UatBrowserClaimHold({ chainId: 143n }).hold(1), false);
});
test("reject mainnet, wrong manager, invalid address and missing persistent file", () => {
  const {dir, config} = fixture();
  try {
    assert.throws(() => new UatBrowserClaimHold({...config, chainId: 143n}), /testnet-only/);
    assert.throws(() => new UatBrowserClaimHold({...config, armedManager: cm}), /mismatch/);
    assert.throws(() => new UatBrowserClaimHold({...config, armedManager: "true"}), /address/);
    assert.throws(() => new UatBrowserClaimHold({...config, file: null}), /persistent/);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
test("hold exactly one draw across restarts; other draws proceed; disarm resumes", () => {
  const {dir, config} = fixture();
  try {
    const hold = new UatBrowserClaimHold(config);
    assert.equal(hold.hold(68), true);
    assert.equal(hold.hold(69), false);
    const restarted = new UatBrowserClaimHold(config);
    assert.equal(restarted.hold(68), true);
    assert.equal(restarted.hold(67), false);
    assert.equal(new UatBrowserClaimHold({...config, armedManager: ""}).hold(68), false);
    assert.throws(() => restarted.hold(0), /Invalid/);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
test("corrupt, wrong-stack and wrong-claim-manager checkpoints fail closed", () => {
  const {dir, config} = fixture();
  try {
    new UatBrowserClaimHold(config).hold(1);
    assert.throws(() => new UatBrowserClaimHold({...config, claimManagerAddress: manager}), /checkpoint/);
    fs.writeFileSync(config.file, "broken");
    assert.throws(() => new UatBrowserClaimHold(config));
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
test("checkpoint write failure cannot silently report a held prize", () => {
  const {dir, config} = fixture();
  try {
    fs.writeFileSync(path.join(dir, "not-a-directory"), "x");
    const hold = new UatBrowserClaimHold({...config, file:path.join(dir,"not-a-directory","hold.json")});
    assert.throws(() => hold.hold(1));
    assert.equal(hold.state, undefined);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
test("keeper selects only after parity and unpaid-leaf checks, and image includes guard", () => {
  const source = fs.readFileSync(new URL("../keeper-v5.js", import.meta.url), "utf8");
  const claim = source.slice(source.indexOf("async function maybeClaim("), source.indexOf("async function runOnce("));
  assert.ok(claim.indexOf("computeWithPythonParity(input)") < claim.indexOf("browserClaimHold.hold(drawId)"));
  assert.ok(claim.indexOf("if (pending.length === 0)") < claim.indexOf("browserClaimHold.hold(drawId)"));
  assert.ok(claim.indexOf("browserClaimHold.hold(drawId)") < claim.indexOf("await send("));
  assert.ok(source.includes("          browserClaimHold,"));
  const docker = fs.readFileSync(new URL("./Dockerfile.v5", import.meta.url), "utf8");
  assert.ok(docker.includes("COPY scripts/keeper/uat-browser-claim-hold.mjs ./scripts/keeper/"));
});