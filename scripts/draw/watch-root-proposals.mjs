#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Interface, JsonRpcProvider, getAddress } from "ethers";
import { spawnSync } from "node:child_process";
import { DrawInputEventCache, buildDrawInput, queryLogsChunked } from "./write-watch-inputs.mjs";

const RPC_URL = process.env.WATCHER_RPC_URL || process.env.RPC_URL;
const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || "deployments/monad-testnet.json";
const CONFIGURED_DRAW_MANAGER_ADDRESS = process.env.DRAW_MANAGER_ADDRESS;
const CONFIGURED_FROM_BLOCK = process.env.WATCHER_FROM_BLOCK || process.env.V5_WATCHER_FROM_BLOCK;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HEALTHCHECKS_PING_URL = process.env.WATCHER_HEALTHCHECKS_PING_URL;

const ABI = [
  "event RootProposed(uint256 indexed drawId, bytes32 indexed root, uint32 winnerCount, uint256 totalPayout, address indexed proposer, bytes32 algorithmVersion, uint64 challengeEndsAt)",
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

async function main() {
  const { drawManagerAddress, fromBlock } = resolveConfig();
  const provider = new JsonRpcProvider(RPC_URL);
  const latest = await provider.getBlockNumber();
  const iface = new Interface(ABI);
  const rootTopic = iface.getEvent("RootProposed").topicHash;
  const logs = await queryLogsChunked(
    provider,
    { address: drawManagerAddress, topics: [rootTopic] },
    fromBlock,
    latest,
    "root-proposals",
  );
  const eventCache = new DrawInputEventCache({
    drawManagerAddress,
    file: process.env.WATCHER_EVENT_CACHE_FILE || path.join(os.tmpdir(), "everdraw-v5-watcher-event-cache.json"),
  });
  let checked = 0;

  for (const log of logs.sort((a, b) => a.blockNumber - b.blockNumber || (a.index ?? 0) - (b.index ?? 0))) {
    const proposal = iface.parseLog(log);
    const drawId = proposal.args.drawId.toString();
    const proposedRoot = proposal.args.root.toLowerCase();
    const input = await buildDrawInput({
      provider,
      drawManagerAddress,
      drawId,
      fromBlock,
      toBlock: latest,
      eventCache,
    });
    const recomputed = recompute(input);
    checked++;
    if (recomputed.root.toLowerCase() !== proposedRoot) {
      await alarm(
        `EverDraw V5 root mismatch draw ${drawId}\nproposed=${proposedRoot}\nrecomputed=${recomputed.root.toLowerCase()}\noperator action: verify and vetoRoot(${drawId}) from Ledger if confirmed`
      );
    }
  }

  if (HEALTHCHECKS_PING_URL) await fetch(HEALTHCHECKS_PING_URL).catch(() => {});
  console.log(`watcher checked ${checked} RootProposed events through block ${latest}`);
}

main().catch(async (err) => {
  await alarm(`EverDraw V5 watcher failed: ${err.stack || err.message}`);
  process.exit(1);
});
