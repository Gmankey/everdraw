#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { spawnSync } from "node:child_process";

const RPC_URL = process.env.WATCHER_RPC_URL || process.env.RPC_URL;
const DRAW_MANAGER_ADDRESS = process.env.DRAW_MANAGER_ADDRESS;
const INPUT_DIR = process.env.WATCHER_DRAW_INPUT_DIR || "draw-inputs";
const POLL_FROM_BLOCK = Number(process.env.WATCHER_FROM_BLOCK || 0);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HEALTHCHECKS_PING_URL = process.env.WATCHER_HEALTHCHECKS_PING_URL;

const ABI = [
  "event RootProposed(uint256 indexed drawId, bytes32 indexed root, uint32 winnerCount, uint256 totalPayout, address indexed proposer, bytes32 algorithmVersion, uint64 challengeEndsAt)",
];

if (!RPC_URL || !DRAW_MANAGER_ADDRESS) {
  console.error("WATCHER_RPC_URL/RPC_URL and DRAW_MANAGER_ADDRESS are required");
  process.exit(2);
}

function recompute(drawId) {
  const inputFile = path.join(INPUT_DIR, `${drawId}.json`);
  if (!fs.existsSync(inputFile)) {
    throw new Error(`missing watcher input ${inputFile}`);
  }
  const child = spawnSync("python3", ["scripts/draw/compute_winners.py", inputFile], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  });
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
  const provider = new JsonRpcProvider(RPC_URL);
  const manager = new Contract(DRAW_MANAGER_ADDRESS, ABI, provider);
  const filter = manager.filters.RootProposed();
  const latest = await provider.getBlockNumber();
  const logs = await manager.queryFilter(filter, POLL_FROM_BLOCK, latest);
  let checked = 0;

  for (const log of logs) {
    const drawId = log.args.drawId.toString();
    const proposedRoot = log.args.root.toLowerCase();
    const recomputed = recompute(drawId);
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
