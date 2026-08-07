#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";

const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || "deployments/monad-testnet.json";
const RPC_URL = process.env.WATCHER_RPC_URL || process.env.KEEPER_RPC_URL || process.env.RPC_URL || process.env.MONAD_TESTNET_RPC_URL;
const DRAW_MANAGER_ADDRESS = process.env.DRAW_MANAGER_ADDRESS;
const INPUT_DIR = process.env.WATCHER_DRAW_INPUT_DIR || process.env.DRAW_INPUT_DIR || "draw-inputs";
const FROM_BLOCK = process.env.V5_WATCHER_FROM_BLOCK || process.env.WATCHER_FROM_BLOCK;
// Dual-RPC: contract eth_calls go to the caller's provider (KEEPER_RPC_URL / official Monad RPC,
// which executes calls but throttles eth_getLogs), while log scans use a logs-optimized RPC.
// On Monad testnet the official RPC throttles getLogs to ~2/s; drpc serves getLogs ~12x faster
// but rejects gas-bearing eth_calls — so we deliberately route each method to the RPC that
// handles it. Override with WATCHER_LOGS_RPC_URL.
const LOGS_RPC_URL = process.env.WATCHER_LOGS_RPC_URL || "https://monad-testnet.gateway.tenderly.co";
const USE_CALLER_LOGS_PROVIDER = LOGS_RPC_URL === "provider";
let _logsProvider;
function logsProvider(provider) {
  if (USE_CALLER_LOGS_PROVIDER) return provider;
  if (!_logsProvider) _logsProvider = new JsonRpcProvider(LOGS_RPC_URL);
  return _logsProvider;
}
function positiveIntEnv(name, fallback) {
  const raw = process.env[name] || String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
}
// Many public RPCs cap eth_getLogs block ranges (Monad testnet: 100). Default to a safe
// window; queryLogsChunked also adaptively halves on a range-limit error so a stricter RPC
// (or a smaller mainnet limit) can't break log collection.
const CHUNK_SIZE = positiveIntEnv("WATCHER_LOG_CHUNK_SIZE", 1000);
const LOG_CONCURRENCY = positiveIntEnv("WATCHER_LOG_CONCURRENCY", 1);
const LOG_TIMEOUT_MS = positiveIntEnv("WATCHER_LOG_TIMEOUT_MS", 30_000);
// Cap how far back log scans reach. Scanning from the deploy block (100k+ blocks) is both slow
// and unnecessary here — deposits relevant to a draw are recent. Bound the window for speed;
// widen via env (or use an event indexer) if very old positions must be discovered. A proper
// indexer is the mainnet path (see tasks/v5-keeper-prediction-fragility-rootcause.md).
// Full history by default (correctness): a depositor from any past period must be discovered.
// With a reliable RPC + 1000-block chunks this stays tolerable; an indexer is the long-term
// path. Override to bound the scan only if you understand the correctness tradeoff.
const MAX_LOG_LOOKBACK = positiveIntEnv("WATCHER_LOG_MAX_LOOKBACK", 50_000_000);
const CACHE_VERSION = 1;

const DRAW_MANAGER_ABI = [
  "function vault() view returns (address)",
  "function twabController() view returns (address)",
  "function claimManager() view returns (address)",
  "function payoutToken() view returns (address)",
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
  "function getTwabBetween(address vault,address account,uint256 startTime,uint256 endTime) view returns (uint256)",
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

function errText(err) {
  return (err?.error?.message || err?.info?.error?.message || err?.message || "").toLowerCase();
}
function errMessage(err) {
  return err?.shortMessage || err?.error?.message || err?.info?.error?.message || err?.message || String(err);
}
function errCode(err) {
  return err?.error?.code ?? err?.info?.error?.code;
}
function isRangeLimitError(err) {
  const msg = errText(err);
  return msg.includes("range") || msg.includes("limited") || msg.includes("too many") || msg.includes("block range");
}
// drpc (and most RPCs) occasionally return a retryable hiccup: "temporary internal error,
// please retry", rate limits, timeouts. These must be retried, not fatal.
function isTransientError(err) {
  const msg = errText(err);
  const code = errCode(err);
  return msg.includes("temporary") || msg.includes("please retry") || msg.includes("try again")
    || msg.includes("timeout") || msg.includes("rate limit") || msg.includes("too many requests")
    // drpc load-balances across backends; some intermittently report the method unavailable
    // (-32601). A retry lands on a backend that supports it.
    || msg.includes("does not exist") || msg.includes("not available") || msg.includes("method not found")
    || code === 19 || code === 429 || code === -32005 || code === -32601;
}

function withTimeout(promise, label, timeoutMs = LOG_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function getLogsWithTimeout(provider, filter, from, to, label) {
  return withTimeout(provider.getLogs({ ...filter, fromBlock: from, toBlock: to }), label);
}

// Fetch logs across [from, to]:
//  - adaptively bisect any sub-range the RPC rejects as too wide,
//  - retry transient RPC errors with backoff (drpc is fast but intermittently flaky),
//  - and, if the fast logs RPC still can't serve a window, fall back to the caller's provider
//    (the official RPC: slow but reliable). So neither a range cap nor drpc flakiness can break
//    log collection.
async function getLogsRange(provider, filter, from, to) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await getLogsWithTimeout(logsProvider(provider), filter, from, to, `logs fast ${from}-${to}`);
    } catch (err) {
      lastErr = err;
      if (isRangeLimitError(err) && to > from) {
        const mid = Math.floor((from + to) / 2);
        const left = await getLogsRange(provider, filter, from, mid);
        const right = await getLogsRange(provider, filter, mid + 1, to);
        return [...left, ...right];
      }
      if (isTransientError(err) && attempt < 5) {
        const delay = 250 * (attempt + 1);
        console.warn(`[logs ${from}-${to}] fast RPC failed attempt ${attempt + 1}/6: ${errMessage(err)}; retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }
  if (USE_CALLER_LOGS_PROVIDER) throw lastErr;
  // Fast logs RPC exhausted retries for this window — fall back to the caller's reliable provider.
  console.warn(`[logs ${from}-${to}] falling back to caller RPC after fast RPC failure: ${errMessage(lastErr)}`);
  try {
    return await getLogsWithTimeout(provider, filter, from, to, `logs fallback ${from}-${to}`);
  } catch (fallbackErr) {
    if (isRangeLimitError(fallbackErr) && to > from) {
      const mid = Math.floor((from + to) / 2);
      const left = await getLogsRange(provider, filter, from, mid);
      const right = await getLogsRange(provider, filter, mid + 1, to);
      return [...left, ...right];
    }
    throw fallbackErr;
  }
}

export async function queryLogsChunked(provider, filter, fromBlock, toBlock, label = "logs", { onBatch } = {}) {
  // Build all [from,to] windows, then fetch them in bounded batches. Default to sequential:
  // Tenderly has hung under concurrent getLogs during live keeper proposeRoot.
  const effectiveFrom = Math.max(Number(fromBlock), Number(toBlock) - MAX_LOG_LOOKBACK);
  const windows = [];
  for (let from = effectiveFrom; from <= Number(toBlock); from += CHUNK_SIZE) {
    windows.push([from, Math.min(from + CHUNK_SIZE - 1, Number(toBlock))]);
  }
  const logs = [];
  const t0 = Date.now();
  console.log(`[${label}] scanning ${windows.length} windows of ${CHUNK_SIZE} blocks (${effectiveFrom}..${toBlock})`);
  for (let i = 0; i < windows.length; i += LOG_CONCURRENCY) {
    const batch = windows.slice(i, i + LOG_CONCURRENCY);
    const results = await Promise.all(batch.map(([f, t]) => getLogsRange(provider, filter, f, t)));
    const batchLogs = results.flat();
    logs.push(...batchLogs);
    if (onBatch) await onBatch({ windows: batch, logs: batchLogs });
    if ((i / LOG_CONCURRENCY) % 10 === 0) {
      console.log(`[${label}] ${Math.min(i + LOG_CONCURRENCY, windows.length)}/${windows.length} windows, ${Math.round((Date.now() - t0) / 1000)}s, ${logs.length} logs`);
    }
  }
  console.log(`[${label}] done: ${windows.length} windows in ${Math.round((Date.now() - t0) / 1000)}s, ${logs.length} logs`);
  return logs;
}


function sortLogs(logs) {
  return logs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return (a.logIndex ?? a.index ?? 0) - (b.logIndex ?? b.index ?? 0);
  });
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export class DrawInputEventCache {
  constructor({ file, drawManagerAddress } = {}) {
    this.file = file || path.join(INPUT_DIR, "keeper-v5-event-cache.json");
    this.drawManagerAddress = drawManagerAddress ? getAddress(drawManagerAddress) : "";
    this.state = this.#read();
  }

  #read() {
    if (!fs.existsSync(this.file)) return this.#fresh();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (parsed.version !== CACHE_VERSION) return this.#fresh();
      if (this.drawManagerAddress && parsed.drawManagerAddress && getAddress(parsed.drawManagerAddress) !== this.drawManagerAddress) {
        return this.#fresh();
      }
      return parsed;
    } catch {
      return this.#fresh();
    }
  }

  #fresh() {
    return {
      version: CACHE_VERSION,
      drawManagerAddress: this.drawManagerAddress || "",
      vaultAddress: "",
      fromBlock: 0,
      deposits: { lastScannedBlock: 0, accounts: [] },
      seeds: { lastScannedBlock: 0, blocks: {} },
      updatedAt: "",
    };
  }

  #ensureScope({ drawManagerAddress, vaultAddress, fromBlock }) {
    const manager = getAddress(drawManagerAddress);
    const vault = getAddress(vaultAddress);
    const expectedStart = Math.max(0, Number(fromBlock) - 1);
    const configuredFromBlock = Number(fromBlock);
    if (
      this.state.version !== CACHE_VERSION ||
      (this.state.drawManagerAddress && getAddress(this.state.drawManagerAddress) !== manager) ||
      (this.state.vaultAddress && getAddress(this.state.vaultAddress) !== vault) ||
      !Number.isSafeInteger(Number(this.state.fromBlock)) ||
      configuredFromBlock < Number(this.state.fromBlock)
    ) {
      this.state = this.#fresh();
    }
    this.state.drawManagerAddress = manager;
    this.state.vaultAddress = vault;
    this.state.fromBlock = this.state.fromBlock ? Math.min(Number(this.state.fromBlock), configuredFromBlock) : configuredFromBlock;
    if (!Number.isSafeInteger(Number(this.state.deposits?.lastScannedBlock)) || this.state.deposits.lastScannedBlock < expectedStart) {
      this.state.deposits = { lastScannedBlock: expectedStart, accounts: [] };
    }
    if (!Number.isSafeInteger(Number(this.state.seeds?.lastScannedBlock)) || this.state.seeds.lastScannedBlock < expectedStart) {
      this.state.seeds = { lastScannedBlock: expectedStart, blocks: {} };
    }
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    atomicWriteJson(this.file, this.state);
  }

  ingestLogs({ drawManagerAddress, vaultAddress, fromBlock, toBlock, logs }) {
    this.#ensureScope({ drawManagerAddress, vaultAddress, fromBlock });
    const manager = getAddress(drawManagerAddress);
    const vault = getAddress(vaultAddress);
    const depositInterface = new Interface(VAULT_ABI);
    const seedInterface = new Interface(DRAW_MANAGER_ABI);
    const depositTopic = depositInterface.getEvent("Deposit").topicHash.toLowerCase();
    const seedTopic = seedInterface.getEvent("SeedReceived").topicHash.toLowerCase();
    const accounts = new Set((this.state.deposits.accounts || []).map((account) => getAddress(account)));
    const blocks = { ...(this.state.seeds.blocks || {}) };

    for (const log of sortLogs(logs)) {
      const address = getAddress(log.address);
      const topic0 = log.topics[0]?.toLowerCase();
      if (address === vault && topic0 === depositTopic) {
        const parsed = depositInterface.parseLog(log);
        accounts.add(getAddress(parsed.args.recipient));
      } else if (address === manager && topic0 === seedTopic) {
        const parsed = seedInterface.parseLog(log);
        blocks[parsed.args.drawId.toString()] = log.blockNumber;
      }
    }

    const scannedThrough = Number(toBlock);
    this.state.deposits = {
      lastScannedBlock: Math.max(Number(this.state.deposits.lastScannedBlock || 0), scannedThrough),
      accounts: [...accounts].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    };
    this.state.seeds = {
      lastScannedBlock: Math.max(Number(this.state.seeds.lastScannedBlock || 0), scannedThrough),
      blocks,
    };
    this.save();
  }

  async syncDeposits({ provider, drawManagerAddress, vaultAddress, fromBlock, toBlock }) {
    this.#ensureScope({ drawManagerAddress, vaultAddress, fromBlock });
    const target = Number(toBlock);
    const last = Number(this.state.deposits.lastScannedBlock || 0);
    if (target <= last) return;

    const iface = new Interface(VAULT_ABI);
    const topic0 = iface.getEvent("Deposit").topicHash;
    const from = last + 1;
    const accounts = new Set((this.state.deposits.accounts || []).map((account) => getAddress(account)));
    await queryLogsChunked(
      provider,
      { address: getAddress(vaultAddress), topics: [topic0] },
      from,
      target,
      "deposits:delta",
      {
        onBatch: ({ windows, logs }) => {
          for (const log of sortLogs(logs)) {
            const parsed = iface.parseLog(log);
            accounts.add(getAddress(parsed.args.recipient));
          }
          this.state.deposits = {
            lastScannedBlock: windows[windows.length - 1][1],
            accounts: [...accounts].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
          };
          this.save();
        },
      },
    );
  }

  async syncSeeds({ provider, drawManagerAddress, vaultAddress, fromBlock, toBlock }) {
    this.#ensureScope({ drawManagerAddress, vaultAddress, fromBlock });
    const target = Number(toBlock);
    const last = Number(this.state.seeds.lastScannedBlock || 0);
    if (target <= last) return;

    const iface = new Interface(DRAW_MANAGER_ABI);
    const topic0 = iface.getEvent("SeedReceived").topicHash;
    const from = last + 1;
    const blocks = { ...(this.state.seeds.blocks || {}) };
    await queryLogsChunked(
      provider,
      { address: getAddress(drawManagerAddress), topics: [topic0] },
      from,
      target,
      "seeds:delta",
      {
        onBatch: ({ windows, logs }) => {
          for (const log of sortLogs(logs)) {
            const parsed = iface.parseLog(log);
            blocks[parsed.args.drawId.toString()] = log.blockNumber;
          }
          this.state.seeds = { lastScannedBlock: windows[windows.length - 1][1], blocks };
          this.save();
        },
      },
    );
  }

  async seedBlockFor({ provider, drawManagerAddress, vaultAddress, drawId, fromBlock, toBlock }) {
    await this.syncSeeds({ provider, drawManagerAddress, vaultAddress, fromBlock, toBlock });
    const block = this.state.seeds.blocks[BigInt(drawId).toString()];
    if (!block) throw new Error(`No SeedReceived event found for draw ${drawId}`);
    return Number(block);
  }

  async participantAccounts({ provider, drawManagerAddress, vaultAddress, fromBlock, toBlock }) {
    await this.syncDeposits({ provider, drawManagerAddress, vaultAddress, fromBlock, toBlock });
    return [...(this.state.deposits.accounts || [])];
  }
}

async function seedBlockFor(provider, manager, drawId, fromBlock, toBlock) {
  // The seed for a draw always arrives shortly before now (after the draw's period). No need to
  // scan full history — search a recent window first, widening only if not found.
  // NOTE: build an explicit {address, topics} filter. ethers' manager.filters.SeedReceived(id)
  // returns a DeferredTopicFilter that does NOT spread to {address,topics}; passing it to
  // getLogs silently drops the topic filter and returns EVERY log (was fetching ~25k logs/1000
  // blocks and hanging the RPC). Pin topic0 + the indexed drawId.
  const iface = new Interface(DRAW_MANAGER_ABI);
  const seedTopic0 = iface.getEvent("SeedReceived").topicHash;
  const drawIdTopic = "0x" + BigInt(drawId).toString(16).padStart(64, "0");
  const filter = { address: getAddress(manager.target), topics: [seedTopic0, drawIdTopic] };
  const seedLookback = Number(process.env.WATCHER_SEED_LOOKBACK || 50_000);
  const recentFrom = Math.max(Number(fromBlock), Number(toBlock) - seedLookback);
  let logs = await queryLogsChunked(provider, filter, recentFrom, toBlock, `seed:d${drawId}`);
  if (logs.length === 0 && recentFrom > Number(fromBlock)) {
    logs = await queryLogsChunked(provider, filter, fromBlock, recentFrom - 1, `seed-wide:d${drawId}`);
  }
  if (logs.length === 0) throw new Error(`No SeedReceived event found for draw ${drawId}`);
  return logs[logs.length - 1].blockNumber;
}

async function participantAccounts(provider, vaultAddress, fromBlock, toBlock) {
  const iface = new Interface(VAULT_ABI);
  const topic0 = iface.getEvent("Deposit").topicHash;
  const logs = await queryLogsChunked(provider, { address: vaultAddress, topics: [topic0] }, fromBlock, toBlock, "deposits");
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
  eventCache,
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
  const seedBlock = eventCache
    ? await eventCache.seedBlockFor({ provider, drawManagerAddress, vaultAddress, drawId, fromBlock, toBlock })
    : await seedBlockFor(provider, manager, drawId, fromBlock, toBlock);
  const twab = new Contract(twabAddress, TWAB_ABI, provider);
  const accountSet = eventCache
    ? await eventCache.participantAccounts({ provider, drawManagerAddress, vaultAddress, fromBlock, toBlock: seedBlock })
    : await participantAccounts(provider, vaultAddress, fromBlock, seedBlock);
  const accounts = [];
  for (const account of accountSet) {
    // getTwabBetween reverts (InsufficientHistory) for an account whose first observation is
    // after this draw's period — i.e. they deposited in a later period and had no balance here.
    // That is a valid "zero for this period" case, not an error: treat as 0 and skip.
    let value = 0n;
    try {
      value = await twab.getTwabBetween(vaultAddress, account, draw.periodStart, draw.periodEnd, { blockTag: seedBlock });
    } catch (err) {
      value = 0n;
    }
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

  const payoutToken = getAddress(await manager.payoutToken());
  const prizeLegs = [{
    token: payoutToken,
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
  const eventCache = new DrawInputEventCache({ drawManagerAddress, file: process.env.WATCHER_EVENT_CACHE_FILE });
  const input = await buildDrawInput({ provider, drawManagerAddress, drawId, fromBlock, toBlock, eventCache });
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
