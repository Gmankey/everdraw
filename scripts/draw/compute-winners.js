#!/usr/bin/env node
import fs from "node:fs";
import { AbiCoder, getAddress, keccak256, solidityPacked } from "ethers";

const abi = AbiCoder.defaultAbiCoder();
export const ALGO_VERSION = "everdraw-v5-draw-algorithm/1";
export const LEAF_DOMAIN = keccak256(Buffer.from("EverDraw.V5.ClaimLeaf", "utf8"));
const ZERO_ROOT = "0x" + "00".repeat(32);

function hex32(value) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`expected bytes32: ${value}`);
  return value.toLowerCase();
}

function uint(value) {
  const out = BigInt(value);
  if (out < 0n) throw new Error(`negative uint: ${value}`);
  return out;
}

function normalize(input) {
  const drawId = uint(input.drawId);
  const drawManager = getAddress(input.drawManager);
  const seed = hex32(input.seed);
  const accounts = [...input.accounts]
    .map((account) => ({ address: getAddress(account.address), twab: uint(account.twab) }))
    .filter((account) => account.twab > 0n)
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const prizeLegs = input.prizeLegs.map((leg) => ({ token: getAddress(leg.token), amount: uint(leg.amount) }));
  const tierBps = input.tierBps.map((bps) => uint(bps));
  return { drawId, drawManager, seed, accounts, prizeLegs, tierBps };
}

function encodedHash(types, values) {
  return keccak256(abi.encode(types, values));
}

function pickWinner(accounts, totalTwab, seed, drawId, position) {
  const r = uint(encodedHash(["bytes32", "uint256", "uint256"], [seed, drawId, BigInt(position)])) % totalTwab;
  let cumulative = 0n;
  for (const account of accounts) {
    cumulative += account.twab;
    if (r < cumulative) return account.address;
  }
  throw new Error("winner search exhausted");
}

function buildLeaves(input) {
  const totalTwab = input.accounts.reduce((sum, account) => sum + account.twab, 0n);
  if (totalTwab === 0n) return { totalTwab, leaves: [], root: ZERO_ROOT, winners: [] };

  const winners = input.tierBps.map((_, position) =>
    pickWinner(input.accounts, totalTwab, input.seed, input.drawId, position)
  );
  const distributionId = encodedHash(["address", "uint256"], [input.drawManager, input.drawId]);
  const leaves = [];
  let leafIndex = 0n;

  for (let position = 0; position < winners.length; position++) {
    for (const leg of input.prizeLegs) {
      const base = (leg.amount * input.tierBps[position]) / 10000n;
      const floorSum = input.tierBps.reduce((sum, bps) => sum + (leg.amount * bps) / 10000n, 0n);
      const dust = position === 0 ? leg.amount - floorSum : 0n;
      const amount = base + dust;
      const leaf = encodedHash(
        ["bytes32", "bytes32", "uint256", "address", "address", "uint256"],
        [LEAF_DOMAIN, distributionId, leafIndex, winners[position], leg.token, amount]
      );
      leaves.push({
        leafIndex: leafIndex.toString(),
        position,
        account: winners[position],
        token: leg.token,
        amount: amount.toString(),
        leaf,
      });
      leafIndex++;
    }
  }

  return { totalTwab, winners, leaves, root: merkleRoot(leaves.map((leaf) => leaf.leaf)) };
}

export function merkleRoot(leaves) {
  if (leaves.length === 0) return ZERO_ROOT;
  let level = leaves.map((leaf) => leaf.toLowerCase()).sort();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i]);
      } else {
        const [a, b] = level[i] < level[i + 1] ? [level[i], level[i + 1]] : [level[i + 1], level[i]];
        next.push(keccak256(solidityPacked(["bytes32", "bytes32"], [a, b])));
      }
    }
    level = next.sort();
  }
  return level[0];
}

export function compute(inputJson) {
  const input = normalize(inputJson);
  const result = buildLeaves(input);
  return {
    algoVersion: ALGO_VERSION,
    root: result.root,
    totalTwab: result.totalTwab.toString(),
    totalPayout: input.prizeLegs.reduce((sum, leg) => sum + leg.amount, 0n).toString(),
    winnerCount: input.tierBps.length,
    winners: result.winners,
    leaves: result.leaves,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(fs.readFileSync(process.argv[2] || 0, "utf8"));
  process.stdout.write(JSON.stringify(compute(input), null, 2) + "\n");
}
