#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Contract, Interface, JsonRpcProvider, ZeroAddress, getAddress } from "ethers";

const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || "deployments/monad-testnet.json";
const RPC_URL = process.env.WATCHER_RPC_URL || process.env.KEEPER_RPC_URL || process.env.RPC_URL || process.env.MONAD_TESTNET_RPC_URL;
const DRAW_MANAGER_ADDRESS = process.env.DRAW_MANAGER_ADDRESS;
const INPUT_DIR = process.env.WATCHER_DRAW_INPUT_DIR || process.env.DRAW_INPUT_DIR || "draw-inputs";
const FROM_BLOCK = process.env.V5_WATCHER_FROM_BLOCK || process.env.WATCHER_FROM_BLOCK;
const CHUNK_SIZE = Number(process.env.WATCHER_LOG_CHUNK_SIZE || 10_000);

const DRAW_MANAGER_ABI = [
  "function vault() view returns (address)",
  "function twabController() view returns (address)",
  "function claimManager() view returns (address)",
  "function draws(uint256) view returns (uint64 periodStart,uint64 periodEnd,uint64 randomnessRequestId,bytes32 seed,uint256 totalTwab,uint256 totalPayout,uint32 winnerCount,uint32 rewardLegCount,bytes32 root,uint64 proposedAt,address proposer,uint8 status,uint256 grossYield,uint256 sponsorYield,uint256 feeAmount)",
  "function drawRewardLegCount(uint256) view returns (uint256)",
  "function drawRewardLegAt(uint256,uint256) view returns (address token,uint256 amount)",
  "function drawFeeRecipientCount(uint256) view returns (uint256)",
  "function drawFeeRecipientAt(uint256,uint256) view returns (address account,uint16 bps)",
  "event SeedReceived(uint256 indexed drawId, uint64 indexed requestId, bytes32 seed)",
];

const VAULT_ABI = [
  "event Deposit(address indexed recipient, uint256 amount)",
];

const TWAB_ABI = [
  "function getTwabBetween(address vault,address account,uint64 startTime,uint64 endTime) view returns (uint256)",
];

function readDeployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) return {};
  const data = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const v5 = [...(data.contracts || [])].reverse().find((entry) => entry.role === "V5 M8 testnet soak");
  return { data, v5 };
}

function requireAddress(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return getAddress(value);
}

function drawStatusName(status) {
  return ["None", "AwaitingSeed", "Seeded", "Proposed", "Finalized", "Skipped"][Number(status)] || `Unknown(${status})`;
}

async function queryLogsChunked(provider, filter, fromBlock, toBlock) {
  const logs = [];
  for (let from = Number(fromBlock); from <= Number(toBlock); from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE - 1, Number(toBlock));
    logs.push(...await provider.getLogs({ ...filter, fromBlock: from, toBlock: to }));
  }
  return logs;
}

async function seedBlockFor(provider, manager, drawId, fromBlock, toBlock) {
  const filter = manager.filters.SeedReceived(drawId);
  const logs = await queryLogsChunked(provider, filter, fromBlock, toBlock);
  if (logs.length === 0) throw new Error(`No SeedReceived event found for draw ${drawId}`);
  return logs[logs.length - 1].blockNumber;
}

async function participantAccounts(provider, vaultAddress, fromBlock, toBlock) {
  const iface = new Interface(VAULT_ABI);
  const topic0 = iface.getEvent("Deposit").topicHash;
  const logs = await queryLogsChunked(provider, { address: vaultAddress, topics: [topic0] }, fromBlock, toBlock);
  const accounts = new Set();
  for (const log of logs) {
    const parsed = iface.parseLog(log);
    accounts.add(getAddress(parsed.args.recipient));
  }
  return [...accounts].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export async function buildDrawInput({
  provider,
  drawManagerAddress,
  drawId,
  fromBlock,
  toBlock,
}) {
  const manager = new Contract(drawManagerAddress, DRAW_MANAGER_ABI, provider);
  const draw = await manager.draws(drawId);
  const status = Number(draw.status);
  if (![2, 3, 4].includes(status)) {
    throw new Error(`Draw ${drawId} is ${drawStatusName(status)}; expected Seeded/Proposed/Finalized`);
  }
  if (draw.seed === "0x" + "00".repeat(32)) throw new Error(`Draw ${drawId} has no seed`);

  const vaultAddress = getAddress(await manager.vault());
  const twabAddress = getAddress(await manager.twabController());
  const seedBlock = await seedBlockFor(provider, manager, drawId, fromBlock, toBlock);
  const twab = new Contract(twabAddress, TWAB_ABI, provider);
  const accountSet = await participantAccounts(provider, vaultAddress, fromBlock, seedBlock);
  const accounts = [];
  for (const account of accountSet) {
    const value = await twab.getTwabBetween(vaultAddress, account, draw.periodStart, draw.periodEnd, { blockTag: seedBlock });
    if (value > 0n) accounts.push({ address: account, twab: value.toString() });
  }

  const summedTwab = accounts.reduce((sum, account) => sum + BigInt(account.twab), 0n);
  if (summedTwab !== draw.totalTwab) {
    throw new Error(`TWAB mismatch for draw ${drawId}: account sum ${summedTwab} != draw total ${draw.totalTwab}`);
  }

  const feeRecipients = [];
  const feeRecipientCount = Number(await manager.drawFeeRecipientCount(drawId));
  let feeBps = 0n;
  for (let i = 0; i < feeRecipientCount; i++) {
    const [account, bps] = await manager.drawFeeRecipientAt(drawId, i);
    feeRecipients.push({ account: getAddress(account), bps: bps.toString() });
    feeBps += BigInt(bps);
  }

  const prizeLegs = [{
    token: ZeroAddress,
    amount: draw.totalPayout.toString(),
    feeAmount: draw.feeAmount.toString(),
  }];
  const rewardLegCount = Number(await manager.drawRewardLegCount(drawId));
  for (let i = 0; i < rewardLegCount; i++) {
    const [token, amount] = await manager.drawRewardLegAt(drawId, i);
    prizeLegs.push({
      token: getAddress(token),
      amount: amount.toString(),
      feeAmount: feeBps === 0n ? "0" : ((BigInt(amount) * feeBps) / 10000n).toString(),
    });
  }

  return {
    algoVersion: "everdraw-v5-draw-algorithm/1",
    drawId: drawId.toString(),
    drawManager: getAddress(drawManagerAddress),
    vault: vaultAddress,
    twabController: twabAddress,
    seed: draw.seed,
    seedBlock,
    periodStart: draw.periodStart.toString(),
    periodEnd: draw.periodEnd.toString(),
    totalTwab: draw.totalTwab.toString(),
    totalPayout: draw.totalPayout.toString(),
    prizeLegs,
    feeRecipients,
    tierBps: [10000],
    accounts,
  };
}

async function main() {
  if (!RPC_URL) throw new Error("Missing WATCHER_RPC_URL/KEEPER_RPC_URL/RPC_URL/MONAD_TESTNET_RPC_URL");
  const { v5 } = readDeployment();
  const drawManagerAddress = requireAddress("DRAW_MANAGER_ADDRESS", DRAW_MANAGER_ADDRESS || v5?.addresses?.drawManager);
  const fromBlock = Number(FROM_BLOCK || v5?.startBlock || 0);
  const drawId = BigInt(process.env.DRAW_ID || process.argv[2] || 0);
  if (drawId <= 0n) throw new Error("Usage: DRAW_ID=<id> npm run draw:watch:inputs -- <id>");

  const provider = new JsonRpcProvider(RPC_URL);
  const toBlock = await provider.getBlockNumber();
  const input = await buildDrawInput({ provider, drawManagerAddress, drawId, fromBlock, toBlock });
  fs.mkdirSync(INPUT_DIR, { recursive: true });
  const file = path.join(INPUT_DIR, `${drawId}.json`);
  fs.writeFileSync(file, JSON.stringify(input, null, 2) + "\n");
  console.log(`wrote ${file} (${input.accounts.length} accounts, seedBlock=${input.seedBlock})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
