#!/usr/bin/env node
import fs from "node:fs";
import { AbiCoder, getAddress, keccak256, solidityPacked } from "ethers";

const abi = AbiCoder.defaultAbiCoder();
export const ALGO_VERSION = "everdraw-v5-draw-algorithm/1";
export const LEAF_DOMAIN = keccak256(Buffer.from("everdraw-v5-claim-leaf/1", "utf8"));
const ZERO_ROOT = "0x" + "00".repeat(32);
const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

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
  const prizeLegs = input.prizeLegs.map((leg) => ({
    token: getAddress(leg.token),
    amount: uint(leg.amount),
    feeAmount: uint(leg.feeAmount || 0),
  }));
  const tierBps = (input.tierBps || [10000]).map((bps) => uint(bps));
  const feeRecipients = (input.feeRecipients || []).map((recipient) => ({
    account: getAddress(recipient.account),
    bps: uint(recipient.bps),
  }));
  const tierSum = tierBps.reduce((sum, bps) => sum + bps, 0n);
  if (tierBps.length === 0 || tierSum !== 10000n) throw new Error(`tierBps must sum to 10000, got ${tierSum}`);
  const feeBps = feeRecipients.reduce((sum, recipient) => sum + recipient.bps, 0n);
  return { drawId, drawManager, seed, accounts, prizeLegs, tierBps, feeRecipients, feeBps };
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
      const winnerPool = leg.amount - allocatedFeeAmount(input, leg.feeAmount);
      const base = (winnerPool * input.tierBps[position]) / 10000n;
      const floorSum = input.tierBps.reduce((sum, bps) => sum + (winnerPool * bps) / 10000n, 0n);
      const dust = position === 0 ? winnerPool - floorSum : 0n;
      const amount = base + dust;
      if (amount === 0n) continue;
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

  for (const leg of input.prizeLegs) {
    if (input.feeBps === 0n || leg.feeAmount === 0n) continue;
    for (const recipient of input.feeRecipients) {
      const amount = (leg.feeAmount * recipient.bps) / input.feeBps;
      if (amount === 0n) continue;
      const leaf = encodedHash(
        ["bytes32", "bytes32", "uint256", "address", "address", "uint256"],
        [LEAF_DOMAIN, distributionId, leafIndex, recipient.account, leg.token, amount]
      );
      leaves.push({
        leafIndex: leafIndex.toString(),
        position: "fee",
        account: recipient.account,
        token: leg.token,
        amount: amount.toString(),
        leaf,
      });
      leafIndex++;
    }
  }

  return { totalTwab, winners, leaves, root: merkleRoot(leaves.map((leaf) => leaf.leaf)) };
}

function allocatedFeeAmount(input, feeAmount) {
  if (input.feeBps === 0n || feeAmount === 0n) return 0n;
  return input.feeRecipients.reduce((sum, recipient) => sum + (feeAmount * recipient.bps) / input.feeBps, 0n);
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

export function merkleProofs(leaves) {
  if (leaves.length === 0) return [];
  const normalized = leaves.map((leaf, index) => ({ leaf: leaf.toLowerCase(), index })).sort((a, b) => a.leaf.localeCompare(b.leaf));
  const proofs = leaves.map(() => []);
  let level = normalized;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i]);
        continue;
      }
      const left = level[i];
      const right = level[i + 1];
      proofs[left.index].push(right.leaf);
      proofs[right.index].push(left.leaf);
      const [a, b] = left.leaf < right.leaf ? [left.leaf, right.leaf] : [right.leaf, left.leaf];
      next.push({ leaf: keccak256(solidityPacked(["bytes32", "bytes32"], [a, b])), index: left.index });
    }
    level = next.sort((a, b) => a.leaf.localeCompare(b.leaf));
  }
  return proofs;
}

export function compute(inputJson) {
  const input = normalize(inputJson);
  const result = buildLeaves(input);
  const proofs = merkleProofs(result.leaves.map((leaf) => leaf.leaf));
  return {
    algoVersion: ALGO_VERSION,
    root: result.root,
    totalTwab: result.totalTwab.toString(),
    totalPayout: input.prizeLegs.find((leg) => leg.token === NATIVE_TOKEN)?.amount.toString() || "0",
    leafCount: result.leaves.length,
    winnerCount: result.leaves.length,
    winners: result.winners,
    leaves: result.leaves.map((leaf, index) => ({ ...leaf, proof: proofs[index] })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(fs.readFileSync(process.argv[2] || 0, "utf8"));
  process.stdout.write(JSON.stringify(compute(input), null, 2) + "\n");
}
