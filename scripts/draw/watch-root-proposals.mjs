#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";
import { spawnSync } from "node:child_process";
import { DrawInputEventCache, buildDrawInput, queryLogsChunked } from "./write-watch-inputs.mjs";

const RPC_URL = process.env.WATCHER_RPC_URL || process.env.RPC_URL;
const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || "deployments/monad-testnet.json";
const CONFIGURED_DRAW_MANAGER_ADDRESS = process.env.DRAW_MANAGER_ADDRESS;
const CONFIGURED_FROM_BLOCK = process.env.WATCHER_FROM_BLOCK || process.env.V5_WATCHER_FROM_BLOCK;
const STATE_FILE = process.env.WATCHER_STATE_FILE || path.join(os.tmpdir(), "everdraw-v5-watcher-state.json");
const MAX_BLOCKS_PER_RUN = Number(process.env.WATCHER_MAX_BLOCKS_PER_RUN || "250000");
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HEALTHCHECKS_PING_URL = process.env.WATCHER_HEALTHCHECKS_PING_URL;

const ABI = [
  "event RootProposed(uint256 indexed drawId, bytes32 indexed root, uint32 winnerCount, uint256 totalPayout, address indexed proposer, bytes32 algorithmVersion, uint64 challengeEndsAt)",
  "event DrawPeriodChangeQueued(uint64 drawPeriod, uint64 effectiveAt)",
  "event SeedReceived(uint256 indexed drawId, uint64 indexed requestId, bytes32 seed)",
  "event Deposit(address indexed recipient, uint256 amount)",
];

function latestV5Deployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) return undefined;
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  return [...(deployment.contracts || [])]
    .reverse()
    .find((entry) => entry.role?.startsWith("V5") && entry.addresses?.drawManager && entry.startBlock);
}

function resolveConfig() {
  const deployment = latestV5Deployment();
  const drawManagerAddress = CONFIGURED_DRAW_MANAGER_ADDRESS || deployment?.addresses?.drawManager;
  const fromBlock = Number(CONFIGURED_FROM_BLOCK || deployment?.startBlock || 0);
  if (!RPC_URL || !drawManagerAddress || !Number.isSafeInteger(fromBlock) || fromBlock < 1) {
    throw new Error(
      "WATCHER_RPC_URL/RPC_URL plus DRAW_MANAGER_ADDRESS and WATCHER_FROM_BLOCK are required (or a recorded V5 deployment)",
    );
  }
  return { drawManagerAddress: getAddress(drawManagerAddress), fromBlock };
}

function readState({ drawManagerAddress, fromBlock }) {
  if (!fs.existsSync(STATE_FILE)) return undefined;
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (
      getAddress(state.drawManagerAddress) !== drawManagerAddress ||
      Number(state.fromBlock) !== fromBlock ||
      !Number.isSafeInteger(Number(state.lastScannedBlock))
    ) {
      return undefined;
    }
    return state;
  } catch {
    return undefined;
  }
}

function writeState({ drawManagerAddress, fromBlock, lastScannedBlock }) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify({ version: 1, drawManagerAddress, fromBlock, lastScannedBlock, updatedAt: new Date().toISOString() }) + "\n",
  );
  fs.renameSync(temp, STATE_FILE);
}

function recompute(input) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-v5-watcher-"));
  const inputFile = path.join(dir, `${input.drawId}.json`);
  fs.writeFileSync(inputFile, JSON.stringify(input));
  const child = spawnSync("python3", ["scripts/draw/compute_winners.py", inputFile], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  if (child.status !== 0) throw new Error(child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

async function alarm(message) {
  console.error(message);
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
    });
  }
  if (HEALTHCHECKS_PING_URL) {
    await fetch(`${HEALTHCHECKS_PING_URL}/fail`, { method: "POST", body: message }).catch(() => {});
  }
}

async function notify(message) {
  console.warn(message);
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
    });
  }
}

async function main() {
  const { drawManagerAddress, fromBlock } = resolveConfig();
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const provider = new JsonRpcProvider(RPC_URL);
  const latest = await provider.getBlockNumber();
  const state = readState({ drawManagerAddress, fromBlock });
  const scanFromBlock = Math.max(fromBlock, Number(state?.lastScannedBlock || fromBlock - 1) + 1);
  if (!Number.isSafeInteger(MAX_BLOCKS_PER_RUN) || MAX_BLOCKS_PER_RUN < 1) throw new Error("WATCHER_MAX_BLOCKS_PER_RUN must be a positive integer");
  const runEnd = Math.min(scanFromBlock + MAX_BLOCKS_PER_RUN - 1, latest);
  const iface = new Interface(ABI);
  const rootTopic = iface.getEvent("RootProposed").topicHash;
  const drawPeriodChangeTopic = iface.getEvent("DrawPeriodChangeQueued").topicHash;
  const eventCache = new DrawInputEventCache({
    drawManagerAddress,
    file: process.env.WATCHER_EVENT_CACHE_FILE || path.join(os.tmpdir(), "everdraw-v5-watcher-event-cache.json"),
  });
  const manager = new Contract(drawManagerAddress, ["function vault() view returns (address)"], provider);
  const vaultAddress = getAddress(await manager.vault());
  let checked = 0;

  if (scanFromBlock <= latest) {
    const seedTopic = iface.getEvent("SeedReceived").topicHash;
    const depositTopic = iface.getEvent("Deposit").topicHash;
    await queryLogsChunked(
      provider,
      {
        address: [drawManagerAddress, vaultAddress],
        topics: [[rootTopic, seedTopic, depositTopic, drawPeriodChangeTopic]],
      },
      scanFromBlock,
      runEnd,
      "watcher-events",
      {
        onBatch: async ({ windows, logs }) => {
          const batchEnd = windows[windows.length - 1][1];
          eventCache.ingestLogs({ drawManagerAddress, vaultAddress, fromBlock, toBlock: batchEnd, logs });
          const cadenceChanges = logs
            .filter(
              (log) =>
                log.address.toLowerCase() === drawManagerAddress.toLowerCase() &&
                log.topics[0]?.toLowerCase() === drawPeriodChangeTopic.toLowerCase(),
            )
            .sort((a, b) => a.blockNumber - b.blockNumber || (a.index ?? 0) - (b.index ?? 0));
          for (const log of cadenceChanges) {
            const queued = iface.parseLog(log);
            await notify(
              `EverDraw V5 draw-period change queued\nnewPeriod=${queued.args.drawPeriod.toString()} seconds\neffectiveAt=${new Date(Number(queued.args.effectiveAt) * 1000).toISOString()}\ntx=${log.transactionHash}`,
            );
          }

          const proposals = logs
            .filter((log) => log.address.toLowerCase() === drawManagerAddress.toLowerCase() && log.topics[0]?.toLowerCase() === rootTopic.toLowerCase())
            .sort((a, b) => a.blockNumber - b.blockNumber || (a.index ?? 0) - (b.index ?? 0));

          for (const log of proposals) {
            const proposal = iface.parseLog(log);
            const drawId = proposal.args.drawId.toString();
            const proposedRoot = proposal.args.root.toLowerCase();
            const input = await buildDrawInput({
              provider,
              drawManagerAddress,
              drawId,
              fromBlock,
              toBlock: batchEnd,
              eventCache,
            });
            const recomputed = recompute(input);
            checked++;
            if (recomputed.root.toLowerCase() !== proposedRoot) {
              await alarm(
                `EverDraw V5 root mismatch draw ${drawId}\nproposed=${proposedRoot}\nrecomputed=${recomputed.root.toLowerCase()}\noperator action: verify and vetoRoot(${drawId}) from Ledger if confirmed`,
              );
            }
          }

          writeState({ drawManagerAddress, fromBlock, lastScannedBlock: batchEnd });
        },
      },
    );
  }
  if (HEALTHCHECKS_PING_URL) await fetch(HEALTHCHECKS_PING_URL).catch(() => {});
  console.log(`watcher checked ${checked} RootProposed events through block ${runEnd} (scan start ${scanFromBlock}, chain head ${latest})`);
}

main().catch(async (err) => {
  await alarm(`EverDraw V5 watcher failed: ${err.stack || err.message}`);
  process.exit(1);
});
