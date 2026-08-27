#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { compute } from "./compute-winners.js";

function hex(n, bytes) {
  return "0x" + BigInt(n).toString(16).padStart(bytes * 2, "0").slice(-(bytes * 2));
}

const accounts = [];
for (let i = 0; i < 100000; i++) {
  accounts.push({ address: hex(i + 1, 20), twab: String(1_000_000_000_000n + BigInt((i * 7919) % 1_000_000)) });
}

const input = {
  drawId: "777",
  drawManager: hex(0xd00d, 20),
  chainId: "10143",
  claimManager: hex(0xc1a1, 20),
  seed: hex(0x123456789abcdefn, 32),
  accounts,
  totalPayout: "1000000000000000000000",
  prizeLegs: [{ token: hex(0, 20), amount: "1000000000000000000000" }],
  tierBps: [6000, 2500, 1000, 500],
};

const startJs = performance.now();
const js = compute(input);
const jsMs = performance.now() - startJs;

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-draw-load-")), "input.json");
fs.writeFileSync(tmp, JSON.stringify(input));
const startPy = performance.now();
const child = spawnSync("python3", ["scripts/draw/compute_winners.py", tmp], { encoding: "utf8", maxBuffer: 1024 * 1024 * 32 });
const pyMs = performance.now() - startPy;
if (child.status !== 0) {
  console.error(child.stderr);
  process.exit(child.status);
}
const py = JSON.parse(child.stdout);
if (js.root.toLowerCase() !== py.root.toLowerCase()) {
  console.error(JSON.stringify({ jsRoot: js.root, pyRoot: py.root }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  accounts: accounts.length,
  root: js.root,
  leafCount: js.leaves.length,
  jsMs: Math.round(jsMs),
  pyMs: Math.round(pyMs),
}, null, 2));
