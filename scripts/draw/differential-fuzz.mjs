#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compute } from "./compute-winners.js";

const CASES = Number(process.env.DRAW_FUZZ_CASES || process.argv[2] || 1000);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-draw-fuzz-"));

function rng(seed) {
  let s = BigInt(seed);
  return () => {
    s ^= s << 13n;
    s ^= s >> 7n;
    s ^= s << 17n;
    return Number(s & 0xffffffffn) / 0x100000000;
  };
}

function hex(n, bytes) {
  return "0x" + BigInt(n).toString(16).padStart(bytes * 2, "0").slice(-(bytes * 2));
}

function addr(n) {
  return hex(n, 20);
}

function makeCase(caseId) {
  const rand = rng(caseId + 1);
  const accountCount = 1 + Math.floor(rand() * 80);
  const accounts = [];
  for (let i = 0; i < accountCount; i++) {
    const deposit = BigInt(1 + Math.floor(rand() * 1_000_000));
    const heldSeconds = BigInt(1 + Math.floor(rand() * 604800));
    const withdrawn = rand() < 0.25 ? BigInt(Math.floor(Number(deposit) * rand())) : 0n;
    const twab = ((deposit - withdrawn) * heldSeconds) / 604800n;
    accounts.push({ address: addr(caseId * 100000 + i + 1), twab: twab.toString() });
  }

  return {
    drawId: String(caseId + 1),
    drawManager: addr(0xd00d0000 + caseId),
    chainId: "10143",
    claimManager: addr(0xc1a10000 + caseId),
    seed: hex(BigInt(caseId + 1) * 0x9e3779b97f4a7c15n, 32),
    accounts,
    totalPayout: String(1_000_000_000_000_000_000n + BigInt(caseId)),
    prizeLegs: [
      { token: addr(0), amount: String(1_000_000_000_000_000_000n + BigInt(caseId)) },
      { token: addr(0xfeed + caseId), amount: String(123_456_789n + BigInt(caseId % 1000)) },
    ],
    tierBps: caseId % 3 === 0 ? [7000, 2000, 1000] : [10000],
  };
}

function pyCompute(input, caseId) {
  const file = path.join(TMP, `case-${caseId}.json`);
  fs.writeFileSync(file, JSON.stringify(input));
  const child = spawnSync("python3", ["scripts/draw/compute_winners.py", file], { encoding: "utf8" });
  if (child.status !== 0) {
    throw new Error(`python failed on case ${caseId}\n${child.stderr}\n${child.stdout}`);
  }
  return JSON.parse(child.stdout);
}

for (let i = 0; i < CASES; i++) {
  const input = makeCase(i);
  const js = compute(input);
  const py = pyCompute(input, i);
  const same =
    js.root.toLowerCase() === py.root.toLowerCase()
    && js.totalTwab === py.totalTwab
    && js.totalPayout === py.totalPayout
    && js.leaves.length === py.leaves.length
    && js.leaves.every((leaf, idx) => leaf.leaf.toLowerCase() === py.leaves[idx].leaf.toLowerCase() && leaf.amount === py.leaves[idx].amount);
  if (!same) {
    console.error(JSON.stringify({ caseId: i, input, js, py }, null, 2));
    process.exit(1);
  }
}

console.log(`draw differential fuzz ok: ${CASES} cases`);
