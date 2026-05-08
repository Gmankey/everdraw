import { JsonRpcProvider, Interface, ethers } from 'ethers';
import type { Block } from 'ethers';
import { nowIso } from '../utils/time.js';
import type { SupportedEventName, RawEventRow } from '../types/domain.js';
import type { RawEventsRepo } from '../repositories/rawEventsRepo.js';
import type { IndexerStateRepo } from '../repositories/indexerStateRepo.js';
import type { DeriveRoundsService } from '../services/deriveRounds.js';
import type { DeriveWalletRoundsService } from '../services/deriveWalletRounds.js';
import type { DeriveWalletStatsService } from '../services/deriveWalletStats.js';
import type { RunnerConfig } from './config.js';
import { POOL_EVENT_ABI } from './abi.js';

const LAST_FINALIZED_BLOCK_KEY = 'last_finalized_block';
const SUPPORTED_EVENTS: SupportedEventName[] = [
  'RoundStarted',
  'DrawCommitted',
  'WinnerDrawn',
  'UnstakeRequested',
  'RoundSettled',
  'RoundSkipped',
  'TicketsBought',
  'PrizeClaimed',
  'PrincipalWithdrawn',
];

export interface IndexerRunner {
  syncOnce(): Promise<{ fromBlock: number; toBlock: number; inserted: number; latestBlock: number; finalizedHead: number }>;
  getStatus(): Promise<{ lastScannedBlock: number; chainHead: number; lag: number }>;
  start(): Promise<never>;
}

export function createIndexerRunner(input: {
  config: RunnerConfig;
  rawEventsRepo: RawEventsRepo;
  indexerStateRepo: IndexerStateRepo;
  deriveRoundsService: DeriveRoundsService;
  deriveWalletRoundsService: DeriveWalletRoundsService;
  deriveWalletStatsService: DeriveWalletStatsService;
}): IndexerRunner {
  const { config, rawEventsRepo, indexerStateRepo, deriveRoundsService, deriveWalletRoundsService, deriveWalletStatsService } = input;
  const provider = new JsonRpcProvider(config.rpcUrl);
  const iface = new Interface(POOL_EVENT_ABI);

  return {
    async syncOnce() {
      console.log('[indexer] syncOnce starting...');
      const latestBlock = await provider.getBlockNumber();
      const finalizedHead = Math.max(config.deployBlock, latestBlock - config.confirmations);
      const lastFinalizedBlock = Number(indexerStateRepo.get(LAST_FINALIZED_BLOCK_KEY)?.value ?? (config.deployBlock - 1));
      const fromBlock = Math.max(config.deployBlock, lastFinalizedBlock + 1);
      const maxBlocksPerSync = 10_000;
      const toBlock = Math.min(finalizedHead, fromBlock + maxBlocksPerSync - 1);
      console.log(`[indexer] chain head: ${latestBlock}, will scan from ${fromBlock} to ${toBlock}`);

      if (fromBlock > finalizedHead) {
        return { fromBlock, toBlock: finalizedHead, inserted: 0, latestBlock, finalizedHead };
      }

      let inserted = 0;
      let chunkCount = 0;
      for (let start = fromBlock; start <= toBlock; start += config.chunkSize) {
        const end = Math.min(toBlock, start + config.chunkSize - 1);
        const rowArrays = await Promise.all(
          config.poolAddresses.map((addr) =>
            fetchChunk({ provider, iface, contractAddress: addr, fromBlock: start, toBlock: end, interChunkDelayMs: 50 })
          )
        );
        const rows = rowArrays.flat();
        if (rows.length > 0) await sleep(500);
        rawEventsRepo.deleteForBlockRange(start, end);
        rawEventsRepo.upsertMany(rows);
        inserted += rows.length;
        chunkCount++;
        if (chunkCount % 1000 === 0) {
          indexerStateRepo.set(LAST_FINALIZED_BLOCK_KEY, String(end), nowIso());
          console.log(`[indexer] checkpoint block ${end} (${chunkCount} chunks, ${inserted} events)`);
        }
      }

      console.log(`[indexer] batch done: scanned ${fromBlock}-${toBlock}, ${inserted} events in ${chunkCount} chunks`);
      if (toBlock >= finalizedHead - 500) {
        deriveRoundsService.rebuildFromRaw();
        deriveWalletRoundsService.rebuildFromRaw();
        deriveWalletStatsService.rebuild();
      }
      indexerStateRepo.set(LAST_FINALIZED_BLOCK_KEY, String(toBlock), nowIso());

      return { fromBlock, toBlock, inserted, latestBlock, finalizedHead };
    },

    async getStatus() {
      const chainHead = await provider.getBlockNumber();
      const lastScannedBlock = Number(indexerStateRepo.get(LAST_FINALIZED_BLOCK_KEY)?.value ?? (config.deployBlock - 1));
      return {
        lastScannedBlock,
        chainHead,
        lag: Math.max(0, chainHead - lastScannedBlock),
      };
    },

    async start() {
      for (;;) {
        try {
          const result = await this.syncOnce();
          console.log('[indexer] sync ok', result);
          const lag = result.finalizedHead - result.toBlock;
          const sleepMs = lag > 1000 ? 200 : config.pollIntervalMs;
          await sleep(sleepMs);
          continue;
        } catch (error) {
          console.error('[indexer] sync failed', error);
        }

        await sleep(config.pollIntervalMs);
      }
    },
  };
}

async function fetchChunk(input: {
 provider: JsonRpcProvider;
 iface: Interface;
 contractAddress: string;
 fromBlock: number;
 toBlock: number;
 interChunkDelayMs: number;
}): Promise<RawEventRow[]> {
 const { provider, iface, contractAddress, fromBlock, toBlock, interChunkDelayMs } = input;
 const output: RawEventRow[] = [];
 const blockCache = new Map<number, Block>();

 const rawLogs = await withRetry(() =>
 provider.getLogs({ address: contractAddress, fromBlock, toBlock })
 );

 for (const log of rawLogs) {
 const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
 if (!parsed) continue;
 if (!SUPPORTED_EVENTS.includes(parsed.name as SupportedEventName)) continue;

 let block = blockCache.get(log.blockNumber);
 if (!block) {
 const fetched = await withRetry(() => provider.getBlock(log.blockNumber));
 if (!fetched) continue;
 block = fetched;
 blockCache.set(log.blockNumber, block);
 }
 output.push(toRawEventRow({ log, parsed, blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString() }));
 }

 await sleep(interChunkDelayMs);
 return output.sort((a, b) => a.blockNumber !== b.blockNumber ? a.blockNumber - b.blockNumber : a.logIndex - b.logIndex);
}

function toRawEventRow(input: {
  log: any;
  parsed: any;
  blockTimestamp: string;
}): RawEventRow {
  const { log, parsed, blockTimestamp } = input;
  const eventName = parsed.name as SupportedEventName;
  const roundId = parsed.args.roundId != null ? Number(parsed.args.roundId) : null;

  let wallet: string | null = null;
  if (parsed.args.buyer) wallet = String(parsed.args.buyer).toLowerCase();
  else if (parsed.args.winner) wallet = String(parsed.args.winner).toLowerCase();
  else if (parsed.args.user) wallet = String(parsed.args.user).toLowerCase();

  const amountMon = parsed.args.monPaid != null
    ? String(parsed.args.monPaid)
    : parsed.args.amount != null
      ? String(parsed.args.amount)
      : parsed.args.prizeAmount != null
        ? String(parsed.args.prizeAmount)
        : null;

  return {
    txHash: log.transactionHash,
    logIndex: Number(log.index),
    blockNumber: Number(log.blockNumber),
    blockHash: log.blockHash,
    blockTimestamp,
    contractAddress: String(log.address).toLowerCase(),
    eventName,
    roundId,
    wallet,
    amountMon,
    payload: JSON.stringify(normalizeArgs(eventName, parsed.args)),
    finalized: 1,
    createdAt: nowIso(),
  };
}

function normalizeArgs(eventName: SupportedEventName, args: any): Record<string, unknown> {
  switch (eventName) {
    case 'RoundStarted':
      return { roundId: Number(args.roundId), salesEndTime: String(args.salesEndTime) };
    case 'WinnerDrawn':
      return { roundId: Number(args.roundId), winner: String(args.winner).toLowerCase(), winningTicket: Number(args.winningTicket) };
    case 'RoundSettled':
      return { roundId: Number(args.roundId), monReceived: String(args.monReceived), yieldMON: String(args.yieldMON), lossRatio: String(args.lossRatio) };
    case 'TicketsBought':
      return { roundId: Number(args.roundId), buyer: String(args.buyer).toLowerCase(), ticketCount: Number(args.ticketCount), monPaid: String(args.monPaid) };
    case 'PrizeClaimed':
      return { roundId: Number(args.roundId), winner: String(args.winner).toLowerCase(), amount: String(args.amount) };
    case 'PrincipalWithdrawn':
      return { roundId: Number(args.roundId), user: String(args.user).toLowerCase(), amount: String(args.amount) };
    default:
      return { roundId: Number(args.roundId) };
  }
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = Math.min(30000, 2000 * Math.pow(2, attempt - 1));
      console.warn(`[indexer] rpc retry ${attempt}/${maxAttempts} after ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
