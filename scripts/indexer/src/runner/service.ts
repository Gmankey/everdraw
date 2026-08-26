import { FallbackProvider, JsonRpcProvider, Interface, ethers } from 'ethers';
import type { Block, AbstractProvider } from 'ethers';
import { nowIso } from '../utils/time.js';
import type { SupportedEventName, RawEventRow } from '../types/domain.js';
import type { RawEventsRepo } from '../repositories/rawEventsRepo.js';
import type { IndexerStateRepo } from '../repositories/indexerStateRepo.js';
import type { DeriveRoundsService } from '../services/deriveRounds.js';
import type { DeriveWalletRoundsService } from '../services/deriveWalletRounds.js';
import type { DeriveWalletStatsService } from '../services/deriveWalletStats.js';
import type { DerivePointsService } from '../services/derivePoints.js';
import type { DeriveV5TranchesService } from '../services/deriveV5Tranches.js';
import type { RunnerConfig } from './config.js';
import { POOL_EVENT_ABI } from './abi.js';

const LAST_FINALIZED_BLOCK_KEY_PREFIX = 'last_finalized_block';
const LAST_POINTS_CHECKPOINT_UNIX_KEY = 'last_points_checkpoint_unix';
export const SUPPORTED_EVENTS: SupportedEventName[] = [
  // Shared
  'RoundStarted',
  'RoundSettled',
  'RoundSkipped',
  'RoundFailed',
  'PrizeClaimed',
  'PrincipalWithdrawn',
  // Legacy V2Compat-only
  'DrawCommitted',
  'WinnerDrawn',
  'UnstakeRequested',
  'TicketsBought',
  // V2-only
  'TicketsPurchased',
  'RoundCommitted',
  // V3-only
  'VRFRequested',
  'VRFFulfilled',
  // V4-only
  'RandomnessRequested',
  'RandomnessFulfilled',
  'EmergencyForceSettled',
  'Deposit',
  'Withdraw',
  'Transfer',
  'BoostDeposit',
  'BoostWithdraw',
  'DrawStarted',
  'DrawSkipped',
  'SeedReceived',
  'RootProposed',
  'RootVetoed',
  'RootFinalized',
  'DrawEconomicsSnapshot',
  'DistributionRegistered',
  'ClaimPaid',
  'ClaimDeferred',
  'DeferredClaimPaid',
  'PrizeCompounded',
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
  deriveV5TranchesService?: DeriveV5TranchesService;
  derivePointsService?: DerivePointsService;
}): IndexerRunner {
  const { config, rawEventsRepo, indexerStateRepo, deriveRoundsService, deriveWalletRoundsService, deriveWalletStatsService, deriveV5TranchesService, derivePointsService } = input;
  const provider = makeProvider(config.rpcUrl, config.rpcUrlFallback);
  const iface = new Interface(POOL_EVENT_ABI);
  const lastFinalizedBlockKey =
    LAST_FINALIZED_BLOCK_KEY_PREFIX + ':' + config.poolAddresses.map((address) => address.toLowerCase()).sort().join(',');

  // Streak/tier/multiplier progression only advances via this checkpoint; it must run on its
  // own cadence (independent of block-scan frequency) or every wallet stays frozen at week 0.
  function maybeRunPointsCheckpoint(): void {
    if (!derivePointsService) return;
    const nowUnix = Math.floor(Date.now() / 1000);
    const lastRunUnix = Number(indexerStateRepo.get(LAST_POINTS_CHECKPOINT_UNIX_KEY)?.value ?? 0);
    if (!isPointsCheckpointDue(nowUnix, lastRunUnix, config.pointsCheckpointIntervalSec)) return;
    const result = derivePointsService.runWeeklyCheckpoint(nowUnix);
    if (!result.skipped) {
      indexerStateRepo.set(LAST_POINTS_CHECKPOINT_UNIX_KEY, String(nowUnix), nowIso());
    }
    console.log('[indexer] points checkpoint', result);
  }

  return {
    async syncOnce() {
      console.log('[indexer] syncOnce starting...');
      const latestBlock = await provider.getBlockNumber();
      const finalizedHead = Math.max(config.deployBlock, latestBlock - config.confirmations);
      const lastFinalizedBlock = Number(indexerStateRepo.get(lastFinalizedBlockKey)?.value ?? (config.deployBlock - 1));
      const fromBlock = Math.max(config.deployBlock, lastFinalizedBlock + 1);
      const toBlock = Math.min(finalizedHead, fromBlock + config.maxBlocksPerSync - 1);
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
          indexerStateRepo.set(lastFinalizedBlockKey, String(end), nowIso());
          console.log(`[indexer] checkpoint block ${end} (${chunkCount} chunks, ${inserted} events)`);
        }
      }

      console.log(`[indexer] batch done: scanned ${fromBlock}-${toBlock}, ${inserted} events in ${chunkCount} chunks`);
      if (toBlock >= finalizedHead - 500) {
        deriveRoundsService.rebuildFromRaw();
        deriveWalletRoundsService.rebuildFromRaw();
        deriveV5TranchesService?.rebuildFromRaw();
        deriveWalletStatsService.rebuild();
        derivePointsService?.rebuildSettlementPoints();
        maybeRunPointsCheckpoint();
      }
      indexerStateRepo.set(lastFinalizedBlockKey, String(toBlock), nowIso());

      return { fromBlock, toBlock, inserted, latestBlock, finalizedHead };
    },

    async getStatus() {
      const chainHead = await provider.getBlockNumber();
      const lastScannedBlock = Number(indexerStateRepo.get(lastFinalizedBlockKey)?.value ?? (config.deployBlock - 1));
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
 provider: AbstractProvider;
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
 let parsed;
 try {
 parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
 } catch {
 continue;
 }
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

function makeProvider(rpcUrl: string, rpcUrlFallback?: string): AbstractProvider {
  const primary = new JsonRpcProvider(rpcUrl);
  if (!rpcUrlFallback) return primary;

  return new FallbackProvider([
    { provider: primary, priority: 1, stallTimeout: 2000 },
    { provider: new JsonRpcProvider(rpcUrlFallback), priority: 2, stallTimeout: 2000 },
  ], undefined, { quorum: 1 });
}

function toRawEventRow(input: {
  log: any;
  parsed: any;
  blockTimestamp: string;
}): RawEventRow {
  const { log, parsed, blockTimestamp } = input;
  const eventName = parsed.name as SupportedEventName;
  const roundId = parsed.args.roundId != null
    ? Number(parsed.args.roundId)
    : parsed.args.drawId != null
      ? Number(parsed.args.drawId)
      : parsed.name === 'DistributionRegistered' && parsed.args.sourceKey != null
        ? Number(BigInt(parsed.args.sourceKey))
      : null;

  let wallet: string | null = null;
  if (parsed.args.buyer) wallet = String(parsed.args.buyer).toLowerCase();
  else if (parsed.args.winner) wallet = String(parsed.args.winner).toLowerCase();
  else if (parsed.args.user) wallet = String(parsed.args.user).toLowerCase();
  else if (parsed.args.recipient) wallet = String(parsed.args.recipient).toLowerCase();
  else if (parsed.args.booster) wallet = String(parsed.args.booster).toLowerCase();
  else if (parsed.args.account) wallet = String(parsed.args.account).toLowerCase();

  const amountMon = parsed.args.monPaid != null
    ? String(parsed.args.monPaid)
    : parsed.args.costMON != null
      ? String(parsed.args.costMON)
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
    // ── Shared ─────────────────────────────────────────────────────────────
    case 'RoundStarted':
      return { roundId: Number(args.roundId), salesEndTime: String(args.salesEndTime) };

    case 'RoundSkipped':
    case 'RoundFailed':
      return { roundId: Number(args.roundId) };

    case 'RoundSettled': {
      // V2 shape: has 'winner' indexed + 'totalPrincipalMON'
      if (args.winner != null) {
        return {
          roundId: Number(args.roundId),
          winner: String(args.winner).toLowerCase(),
          winningTicket: Number(args.winningTicket),
          monReceived: String(args.totalPrincipalMON ?? 0n),
          yieldMON: '0',
          lossRatio: '0',
        };
      }
      // V3 shape: principalShares + prizeShares; no winner (winner is in separate WinnerDrawn)
      if (args.principalShares != null) {
        return {
          roundId: Number(args.roundId),
          principalShares: String(args.principalShares),
          prizeShares: String(args.prizeShares),
          monReceived: '0',
          yieldMON: '0',
          lossRatio: '0',
        };
      }
      // Legacy shape: monReceived + yieldMON + lossRatio
      return {
        roundId: Number(args.roundId),
        monReceived: String(args.monReceived),
        yieldMON: String(args.yieldMON),
        lossRatio: String(args.lossRatio),
      };
    }

    case 'PrizeClaimed': {
      // V2 shape: prizeShares + shareRateAtClaim; compute approximate MON value
      if (args.prizeShares != null) {
        const prizeShares = BigInt(args.prizeShares);
        const shareRate = BigInt(args.shareRateAtClaim);
        const amount = (prizeShares * shareRate) / (10n ** 18n);
        return { roundId: Number(args.roundId), winner: String(args.winner).toLowerCase(), amount: String(amount) };
      }
      // Legacy shape: amount in MON directly
      return { roundId: Number(args.roundId), winner: String(args.winner).toLowerCase(), amount: String(args.amount) };
    }

    case 'PrincipalWithdrawn': {
      // V2 shape: sharesReturned + shareRateAtWithdraw; compute approximate MON value
      if (args.sharesReturned != null) {
        const sharesReturned = BigInt(args.sharesReturned);
        const shareRate = BigInt(args.shareRateAtWithdraw);
        const amount = (sharesReturned * shareRate) / (10n ** 18n);
        return { roundId: Number(args.roundId), user: String(args.user).toLowerCase(), amount: String(amount) };
      }
      // Legacy shape: amount in MON directly
      return { roundId: Number(args.roundId), user: String(args.user).toLowerCase(), amount: String(args.amount) };
    }

    // ── Legacy V2Compat-only ────────────────────────────────────────────────
    case 'DrawCommitted':
      return { roundId: Number(args.roundId), targetBlockNumber: String(args.targetBlockNumber) };

    case 'WinnerDrawn':
      return { roundId: Number(args.roundId), winner: String(args.winner).toLowerCase(), winningTicket: Number(args.winningTicket) };

    case 'UnstakeRequested':
      return { roundId: Number(args.roundId), completionEpoch: String(args.completionEpoch), shmonShares: String(args.shmonShares) };

    case 'TicketsBought':
      return { roundId: Number(args.roundId), buyer: String(args.buyer).toLowerCase(), ticketCount: Number(args.ticketCount), monPaid: String(args.monPaid) };

    // ── V2-only ────────────────────────────────────────────────────────────
    case 'TicketsPurchased':
      // Normalize to same payload shape as TicketsBought so derive services need no V2-specific branching
      return { roundId: Number(args.roundId), buyer: String(args.buyer).toLowerCase(), ticketCount: Number(args.ticketCount), monPaid: String(args.costMON) };

    case 'RoundCommitted':
      return { roundId: Number(args.roundId), targetBlockNumber: String(args.targetBlockNumber) };

    // ── V3-only ────────────────────────────────────────────────────────────
    case 'VRFRequested':
      return { roundId: Number(args.roundId), sequence: String(args.sequence), fee: String(args.fee) };

    case 'VRFFulfilled':
      return { roundId: Number(args.roundId), sequence: String(args.sequence) };

    // ── V4-only ────────────────────────────────────────────────────────────
    case 'RandomnessRequested':
      return { roundId: Number(args.roundId), sequence: String(args.requestId), fee: String(args.fee) };

    case 'RandomnessFulfilled':
      return { roundId: Number(args.roundId), sequence: String(args.requestId) };

    case 'EmergencyForceSettled':
      return { roundId: Number(args.roundId) };

    // ── V5 PrizeVaultV5 ────────────────────────────────────────────────────
    case 'Deposit':
      return { recipient: String(args.recipient).toLowerCase(), amount: String(args.amount) };

    case 'Withdraw':
      return { recipient: String(args.recipient).toLowerCase(), amount: String(args.amount) };

    case 'Transfer':
      return { from: String(args.from).toLowerCase(), to: String(args.to).toLowerCase(), amount: String(args.amount) };

    case 'BoostDeposit':
      return {
        booster: String(args.booster).toLowerCase(),
        amount: String(args.amount),
        balance: String(args.balance),
        timestamp: String(args.timestamp),
      };

    case 'BoostWithdraw':
      return {
        booster: String(args.booster).toLowerCase(),
        amount: String(args.amount),
        balance: String(args.balance),
        timestamp: String(args.timestamp),
      };

    // ── V5 DrawManagerV5 ───────────────────────────────────────────────────
    case 'DrawStarted':
      return {
        drawId: Number(args.drawId),
        periodStart: String(args.periodStart),
        periodEnd: String(args.periodEnd),
        totalTwab: String(args.totalTwab),
        totalPayout: String(args.totalPayout),
        requestId: String(args.requestId),
      };

    case 'DrawSkipped':
      return {
        drawId: Number(args.drawId),
        periodStart: String(args.periodStart),
        periodEnd: String(args.periodEnd),
        totalTwab: String(args.totalTwab),
        availablePrize: String(args.availablePrize),
        reason: String(args.reason),
      };

    case 'SeedReceived':
      return { drawId: Number(args.drawId), requestId: String(args.requestId), seed: String(args.seed) };

    case 'RootProposed':
      return {
        drawId: Number(args.drawId),
        root: String(args.root),
        winnerCount: Number(args.winnerCount),
        totalPayout: String(args.totalPayout),
        proposer: String(args.proposer).toLowerCase(),
        algorithmVersion: String(args.algorithmVersion),
        challengeEndsAt: String(args.challengeEndsAt),
      };

    case 'RootVetoed':
      return {
        drawId: Number(args.drawId),
        root: String(args.root),
        guardian: String(args.guardian).toLowerCase(),
        proposeAfter: String(args.proposeAfter),
      };

    case 'RootFinalized':
      return {
        drawId: Number(args.drawId),
        root: String(args.root),
        winnerCount: Number(args.winnerCount),
        totalPayout: String(args.totalPayout),
      };

    case 'DrawEconomicsSnapshot':
      return {
        drawId: Number(args.drawId),
        grossYield: String(args.grossYield),
        sponsorYield: String(args.sponsorYield),
        feeAmount: String(args.feeAmount),
        totalPayout: String(args.totalPayout),
      };

    // ── V5 ClaimManagerV5 ─────────────────────────────────────────────────
    case 'DistributionRegistered':
      return {
        distributionId: String(args.distributionId),
        source: String(args.source).toLowerCase(),
        sourceKey: String(args.sourceKey),
        root: String(args.root),
        leafCount: Number(args.leafCount),
        metadata: String(args.metadata),
      };

    case 'ClaimPaid':
    case 'ClaimDeferred':
    case 'DeferredClaimPaid':
      return {
        distributionId: String(args.distributionId),
        leafIndex: String(args.leafIndex),
        account: String(args.account).toLowerCase(),
        token: String(args.token).toLowerCase(),
        amount: String(args.amount),
      };

    case 'PrizeCompounded':
      return {
        distributionId: String(args.distributionId),
        leafIndex: String(args.leafIndex),
        account: String(args.account).toLowerCase(),
        amount: String(args.amount),
      };

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

export function isPointsCheckpointDue(nowUnix: number, lastRunUnix: number, intervalSec: number): boolean {
  return nowUnix - lastRunUnix >= intervalSec;
}
