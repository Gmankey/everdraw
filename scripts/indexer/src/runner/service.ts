import { FetchRequest, JsonRpcProvider, Interface, ethers } from 'ethers';
import type { Block, AbstractProvider } from 'ethers';
import { nowIso, nowUnix } from '../utils/time.js';
import type { SupportedEventName, RawEventRow, V5DeploymentScope } from '../types/domain.js';
import type { RawEventsRepo } from '../repositories/rawEventsRepo.js';
import type { IndexerStateRepo } from '../repositories/indexerStateRepo.js';
import type { DeriveRoundsService } from '../services/deriveRounds.js';
import type { DeriveWalletRoundsService } from '../services/deriveWalletRounds.js';
import type { DeriveWalletStatsService } from '../services/deriveWalletStats.js';
import type { DerivePointsService } from '../services/derivePoints.js';
import type { DeriveV5TranchesService } from '../services/deriveV5Tranches.js';
import type { PointsReplayStateRepo } from '../repositories/pointsReplayStateRepo.js';
import type { RunnerConfig } from './config.js';
import { POOL_EVENT_ABI } from './abi.js';
import { RpcPolicy, redactRpcSecrets } from './rpcPolicy.js';
import type { RpcProviderRole, RpcTelemetrySnapshot } from './rpcPolicy.js';

const LAST_FINALIZED_BLOCK_KEY_PREFIX = 'last_finalized_block';
const LAST_FINALIZED_BLOCK_HASH_KEY_PREFIX = 'last_finalized_block_hash';
const CANONICAL_HISTORY_KEY_PREFIX = 'canonical_history';
const REWIND_COUNT_KEY_PREFIX = 'rewind_count';
const MAX_CANONICAL_CHECKPOINTS = 512;
// After a failed points replay, wait this long before retrying. A formula mismatch throws
// cheaply, but a fault deeper in the replay would otherwise re-run the whole rebuild every
// poll cycle and log on every one of them.
const POINTS_REPLAY_RETRY_DELAY_MS = 60_000;

type CanonicalCheckpoint = { blockNumber: number; blockHash: string };
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

/**
 * Points health, reported separately from ingestion health.
 *
 * `degraded` means the canonical replay is failing and points are frozen at the last
 * successful rebuild. Event ingestion and every other derived table are unaffected, so the
 * indexer as a whole is not down -- alerting should key on this field, not on sync failures.
 */
export interface PointsReplayStatus {
  status: 'ok' | 'degraded' | 'pending' | 'disabled' | 'unknown';
  lastSuccessUnix: number | null;
  lastErrorUnix: number | null;
  lastError: string | null;
  /** Seconds since the last successful replay, or null if there has never been one. */
  staleSeconds: number | null;
}

export interface IndexerRunner {
  validateConfiguration(): Promise<void>;
  syncOnce(): Promise<{ fromBlock: number; toBlock: number; inserted: number; latestBlock: number; finalizedHead: number }>;
  getStatus(): Promise<{
    lastScannedBlock: number;
    chainHead: number;
    confirmedHead: number;
    lag: number;
    canonicalHash: string | null;
    rewindCount: number;
    v5Deployments: V5DeploymentScope[];
    points: PointsReplayStatus;
    rpc: RpcTelemetrySnapshot;
  }>;
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
  pointsReplayStateRepo?: PointsReplayStateRepo;
  provider?: AbstractProvider;
  logsProvider?: AbstractProvider;
  fallbackProvider?: AbstractProvider;
  deploymentWiringReader?: (deployment: V5DeploymentScope) => Promise<{
    vaultDrawManager: string;
    managerVault: string;
    managerClaimManager: string;
    sourceAuthorized: boolean;
  }>;
  providersToValidate?: AbstractProvider[];
}): IndexerRunner {
  const { config, rawEventsRepo, indexerStateRepo, deriveRoundsService, deriveWalletRoundsService, deriveWalletStatsService, deriveV5TranchesService, derivePointsService, pointsReplayStateRepo } = input;
  const rpcPolicy = new RpcPolicy({
    timeoutMs: config.rpcTimeoutMs ?? 10_000,
    attempts: config.rpcRetryAttempts ?? 3,
    baseDelayMs: config.rpcRetryBaseDelayMs ?? 500,
    maxDelayMs: config.rpcRetryMaxDelayMs ?? 5_000,
    fallbackMaxRequestsPerHour: config.fallbackMaxRequestsPerHour ?? 0,
    fallbackCooldownMs: config.fallbackCooldownMs ?? 60_000,
  });
  const providerBundle = input.provider
    ? {
      canonicalProvider: input.provider,
      logsProvider: input.logsProvider ?? input.provider,
      fallbackProvider: input.fallbackProvider,
      providersToValidate: input.providersToValidate
        ?? [input.provider, input.logsProvider, input.fallbackProvider].filter(Boolean) as AbstractProvider[],
    }
    : makeProviders(config, rpcPolicy);
  const provider = providerBundle.canonicalProvider;
  const logsProvider = providerBundle.logsProvider;
  const fallbackProvider = providerBundle.fallbackProvider;
  const canonicalRequest = <T>(
    method: string,
    operation: () => Promise<T>,
    fallback?: () => Promise<T>,
    fallbackReason?: string,
  ) => rpcPolicy.request({ role: 'canonical', method, operation, fallback, fallbackReason });
  const deploymentWiringReader = input.deploymentWiringReader
    ?? createDeploymentWiringReader(provider, fallbackProvider, rpcPolicy);
  const iface = new Interface(POOL_EVENT_ABI);
  const stateScope = config.chainId + ':' + config.poolAddresses.map((address) => address.toLowerCase()).sort().join(',');
  const lastFinalizedBlockKey = LAST_FINALIZED_BLOCK_KEY_PREFIX + ':' + stateScope;
  const lastFinalizedBlockHashKey = LAST_FINALIZED_BLOCK_HASH_KEY_PREFIX + ':' + stateScope;
  const canonicalHistoryKey = CANONICAL_HISTORY_KEY_PREFIX + ':' + stateScope;
  const rewindCountKey = REWIND_COUNT_KEY_PREFIX + ':' + stateScope;
  let configurationValidated = false;
  let lastPointsReplayAtMs = 0;

  function rebuildDerivedState(): void {
    deriveRoundsService.rebuildFromRaw();
    deriveWalletRoundsService.rebuildFromRaw();
    deriveV5TranchesService?.rebuildFromRaw();
    deriveWalletStatsService.rebuild();
    rebuildPoints();
  }

  /**
   * The canonical points replay, isolated from the rest of the sync.
   *
   * Two separate things happen here. First, the replay runs inside its own try/catch:
   * assertFormulaCompatible() throws by design when the formula changed without a migration,
   * and an unhandled throw here made every sync cycle report failure forever while
   * /api/health still showed an advancing cursor. Points are derived and carry no monetary
   * value, so freezing them is survivable; making ingestion look broken is not. The failure
   * is recorded so monitoring sees it as a points problem specifically.
   *
   * Second, the replay is skipped when nothing it reads has changed. It is O(draws x wallets)
   * and, once the indexer is caught up, rebuildDerivedState() runs on essentially every poll.
   *
   * The guard errs towards replaying: it runs on the first cycle of every process (so a code
   * or config change always rebuilds), after any recorded failure, whenever the input
   * signature moves, and at least once every config.pointsReplayMaxIdleMs regardless. A
   * signature that somehow missed a change therefore costs bounded staleness, not permanent
   * staleness. The full replay remains the only mechanism that computes points.
   */
  function rebuildPoints(): void {
    if (!derivePointsService) return;
    if (!pointsReplayStateRepo) {
      // No state store wired (tests, one-shot rebuild scripts): replay unconditionally.
      derivePointsService.rebuildSettlementPoints();
      return;
    }

    const fingerprint = derivePointsService.inputFingerprint();
    const previous = pointsReplayStateRepo.read();
    const idleMs = Date.now() - lastPointsReplayAtMs;
    // Never back off for longer than the backstop interval, so POINTS_REPLAY_MAX_IDLE_MS=0
    // disables the guard completely -- retry backoff included -- and restores the previous
    // replay-every-cycle behaviour.
    const retryDelayMs = Math.min(POINTS_REPLAY_RETRY_DELAY_MS, config.pointsReplayMaxIdleMs);
    if (previous.lastError != null) {
      if (idleMs < retryDelayMs) return;
    } else if (
      previous.signature != null
      && previous.signature === pointsReplayStateRepo.computeInputSignature(fingerprint)
      && idleMs < config.pointsReplayMaxIdleMs
    ) {
      return;
    }

    try {
      derivePointsService.rebuildSettlementPoints();
      // Recomputed after the replay: the signature covers the replay's own output tables, so
      // an operator truncating them forces the next cycle to rebuild rather than skip.
      pointsReplayStateRepo.recordSuccess(
        pointsReplayStateRepo.computeInputSignature(fingerprint),
        nowUnix(),
      );
    } catch (error) {
      const redactedError = redactRpcSecrets(error instanceof Error ? error.stack ?? error.message : error);
      pointsReplayStateRepo.recordFailure(redactedError, nowUnix());
      console.error(
        '[indexer][points] replay failed; event ingestion and all other derived state are'
        + ' unaffected. Points are frozen at the last successful replay and rebuild once this'
        + ' is resolved. See points.status in /api/health:',
        redactedError,
      );
    } finally {
      lastPointsReplayAtMs = Date.now();
    }
  }

  function pointsStatus(): PointsReplayStatus {
    const empty = { lastSuccessUnix: null, lastErrorUnix: null, lastError: null, staleSeconds: null };
    if (!derivePointsService) return { status: 'disabled', ...empty };
    if (!pointsReplayStateRepo) return { status: 'unknown', ...empty };
    const state = pointsReplayStateRepo.read();
    const status = state.lastError != null
      ? 'degraded'
      : state.lastSuccessUnix != null ? 'ok' : 'pending';
    return {
      status,
      lastSuccessUnix: state.lastSuccessUnix,
      lastErrorUnix: state.lastErrorUnix,
      lastError: state.lastError,
      staleSeconds: state.lastSuccessUnix != null ? nowUnix() - state.lastSuccessUnix : null,
    };
  }

  function canonicalHistory(): CanonicalCheckpoint[] {
    const raw = indexerStateRepo.get(canonicalHistoryKey)?.value;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as CanonicalCheckpoint[];
      return parsed.filter(
        (item) =>
          Number.isInteger(item.blockNumber) &&
          item.blockNumber >= config.deployBlock &&
          /^0x[0-9a-f]{64}$/i.test(item.blockHash)
      );
    } catch {
      return [];
    }
  }

  function saveCanonicalHistory(history: CanonicalCheckpoint[]): void {
    indexerStateRepo.set(
      canonicalHistoryKey,
      JSON.stringify(history.slice(-MAX_CANONICAL_CHECKPOINTS)),
      nowIso()
    );
  }

  async function recordCanonicalCheckpoint(blockNumber: number): Promise<void> {
    const block = await canonicalRequest(
      'eth_getBlockByNumber',
      () => provider.getBlock(blockNumber),
      fallbackProvider ? () => fallbackProvider.getBlock(blockNumber) : undefined,
      'canonical-checkpoint',
    );
    if (!block?.hash) throw new Error(`Missing canonical block hash for ${blockNumber}`);
    const checkpoint = { blockNumber, blockHash: block.hash.toLowerCase() };
    const history = canonicalHistory().filter((item) => item.blockNumber < blockNumber);
    history.push(checkpoint);
    saveCanonicalHistory(history);
    indexerStateRepo.set(lastFinalizedBlockKey, String(blockNumber), nowIso());
    indexerStateRepo.set(lastFinalizedBlockHashKey, checkpoint.blockHash, nowIso());
  }

  async function reconcileCanonicalCursor(): Promise<number> {
    const cursor = Number(indexerStateRepo.get(lastFinalizedBlockKey)?.value ?? (config.deployBlock - 1));
    if (cursor < config.deployBlock) return cursor;

    const expectedHash = indexerStateRepo.get(lastFinalizedBlockHashKey)?.value.toLowerCase();
    const current = await canonicalRequest(
      'eth_getBlockByNumber',
      () => provider.getBlock(cursor),
      fallbackProvider ? () => fallbackProvider.getBlock(cursor) : undefined,
      'cursor-reconciliation',
    );
    if (current?.hash && (!expectedHash || current.hash.toLowerCase() === expectedHash)) {
      if (!expectedHash) await recordCanonicalCheckpoint(cursor);
      return cursor;
    }

    let ancestor = config.deployBlock - 1;
    let ancestorHash: string | null = null;
    const history = canonicalHistory().filter((item) => item.blockNumber < cursor).reverse();
    for (const checkpoint of history) {
      const block = await canonicalRequest(
        'eth_getBlockByNumber',
        () => provider.getBlock(checkpoint.blockNumber),
        fallbackProvider ? () => fallbackProvider.getBlock(checkpoint.blockNumber) : undefined,
        'reorg-ancestor-search',
      );
      if (block?.hash?.toLowerCase() === checkpoint.blockHash.toLowerCase()) {
        ancestor = checkpoint.blockNumber;
        ancestorHash = checkpoint.blockHash.toLowerCase();
        break;
      }
    }

    rawEventsRepo.deleteFromBlock(ancestor + 1);
    indexerStateRepo.set(lastFinalizedBlockKey, String(ancestor), nowIso());
    indexerStateRepo.set(lastFinalizedBlockHashKey, ancestorHash ?? '', nowIso());
    saveCanonicalHistory(canonicalHistory().filter((item) => item.blockNumber <= ancestor));
    const rewindCount = Number(indexerStateRepo.get(rewindCountKey)?.value ?? 0) + 1;
    indexerStateRepo.set(rewindCountKey, String(rewindCount), nowIso());
    rebuildDerivedState();
    console.warn(`[indexer] canonical divergence at ${cursor}; rewound to ${ancestor}`);
    return ancestor;
  }

  async function canonicalBlockHash(blockNumber: number): Promise<string> {
    const block = await canonicalRequest(
      'eth_getBlockByNumber',
      () => provider.getBlock(blockNumber),
      fallbackProvider ? () => fallbackProvider.getBlock(blockNumber) : undefined,
      'range-boundary',
    );
    if (!block?.hash) throw new Error(`Missing canonical block hash for ${blockNumber}`);
    return block.hash.toLowerCase();
  }

  function canonicalStateUpdates(blockNumber: number, blockHash: string) {
    const history = canonicalHistory().filter((item) => item.blockNumber < blockNumber);
    history.push({ blockNumber, blockHash });
    const updatedAt = nowIso();
    return [
      {
        key: canonicalHistoryKey,
        value: JSON.stringify(history.slice(-MAX_CANONICAL_CHECKPOINTS)),
        updatedAt,
      },
      { key: lastFinalizedBlockKey, value: String(blockNumber), updatedAt },
      { key: lastFinalizedBlockHashKey, value: blockHash, updatedAt },
    ];
  }

  return {
    async validateConfiguration() {
      if (configurationValidated) return;
      for (const [index, chainProvider] of providerBundle.providersToValidate.entries()) {
        await assertProviderChainId(
          chainProvider,
          config.chainId,
          `indexer RPC provider ${index + 1}`
        );
      }
      for (const deployment of config.v5Deployments) {
        const wiring = await deploymentWiringReader(deployment);
        const expected = {
          vaultDrawManager: deployment.drawManagerAddress,
          managerVault: deployment.vaultAddress,
          managerClaimManager: deployment.claimManagerAddress,
        };
        for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
          if (wiring[key].toLowerCase() !== expected[key].toLowerCase()) {
            throw new Error(
              `V5 deployment wiring mismatch for ${key}: expected ${expected[key]}, got ${wiring[key]}`
            );
          }
        }
        if (!wiring.sourceAuthorized) {
          throw new Error(
            `V5 deployment source is not authorized: ${deployment.drawManagerAddress} -> ${deployment.claimManagerAddress}`
          );
        }

      }
      configurationValidated = true;
    },

    async syncOnce() {
      console.log('[indexer] syncOnce starting...');
      const latestBlock = await canonicalRequest(
        'eth_blockNumber',
        () => provider.getBlockNumber(),
        fallbackProvider ? () => fallbackProvider.getBlockNumber() : undefined,
        'chain-head',
      );
      const finalizedHead = Math.max(config.deployBlock, latestBlock - config.confirmations);
      const lastFinalizedBlock = await reconcileCanonicalCursor();
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
        const [beforeStartHash, beforeEndHash] = await Promise.all([
          canonicalBlockHash(start),
          canonicalBlockHash(end),
        ]);
        const rows = await fetchChunk({
          canonicalProvider: provider,
          logsProvider,
          fallbackProvider,
          rpcPolicy,
          iface,
          contractAddresses: config.poolAddresses,
          fromBlock: start,
          toBlock: end,
          interChunkDelayMs: 50,
        });
        const [afterStartHash, afterEndHash] = await Promise.all([
          canonicalBlockHash(start),
          canonicalBlockHash(end),
        ]);
        if (beforeStartHash !== afterStartHash || beforeEndHash !== afterEndHash) {
          throw new Error(`Canonical range changed during fetch: ${start}-${end}`);
        }
        rawEventsRepo.commitCanonicalRange({
          fromBlock: start,
          toBlock: end,
          rows,
          stateUpdates: canonicalStateUpdates(end, afterEndHash),
        });
        inserted += rows.length;
        chunkCount++;
        if (chunkCount % 1000 === 0) {
          console.log(`[indexer] checkpoint block ${end} (${chunkCount} chunks, ${inserted} events)`);
        }
      }

      console.log(`[indexer] batch done: scanned ${fromBlock}-${toBlock}, ${inserted} events in ${chunkCount} chunks`);
      if (toBlock >= finalizedHead - 500) {
        rebuildDerivedState();
      }
      return { fromBlock, toBlock, inserted, latestBlock, finalizedHead };
    },

    async getStatus() {
      const chainHead = await rpcPolicy.request({
        role: 'canonical',
        method: 'eth_blockNumber',
        operation: () => provider.getBlockNumber(),
      });
      const confirmedHead = Math.max(config.deployBlock, chainHead - config.confirmations);
      const lastScannedBlock = Number(indexerStateRepo.get(lastFinalizedBlockKey)?.value ?? (config.deployBlock - 1));
      return {
        lastScannedBlock,
        chainHead,
        confirmedHead,
        lag: Math.max(0, confirmedHead - lastScannedBlock),
        canonicalHash: indexerStateRepo.get(lastFinalizedBlockHashKey)?.value || null,
        rewindCount: Number(indexerStateRepo.get(rewindCountKey)?.value ?? 0),
        v5Deployments: config.v5Deployments,
        points: pointsStatus(),
        rpc: rpcPolicy.snapshot(),
      };
    },

    async start() {
      await this.validateConfiguration();
      for (;;) {
        try {
          const result = await this.syncOnce();
          console.log('[indexer] sync ok', result);
          const lag = result.finalizedHead - result.toBlock;
          const sleepMs = lag > 1000 ? 200 : config.pollIntervalMs;
          await sleep(sleepMs);
          continue;
        } catch (error) {
          console.error('[indexer] sync failed', redactRpcSecrets(error instanceof Error ? error.stack ?? error.message : error));
        }

        await sleep(config.pollIntervalMs);
      }
    },
  };
}

function rpcErrorText(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (value == null || depth > 6 || seen.has(value)) return;
    if (typeof value === 'string') {
      messages.push(value);
      try { visit(JSON.parse(value), depth + 1); } catch {}
      return;
    }
    if (typeof value !== 'object') return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["shortMessage", "message", "reason", "body", "error", "info", "data"]) {
      visit(record[key], depth + 1);
    }
    for (const [key, nested] of Object.entries(record)) {
      if (['shortMessage', 'message', 'reason', 'body', 'error', 'info', 'data'].includes(key)) {
        visit(nested, depth + 1);
      }
    }
  };
  visit(error, 0);
  return messages.join(' | ').toLowerCase();
}

export function isLogRangeLimitError(error: unknown): boolean {
  const message = rpcErrorText(error);
  if (/rate limit|quota|compute unit|capacity|too many requests|\b429\b/.test(message)) return false;
  const identifiesBlockResults = /block|eth_getlogs|log result/.test(message);
  const identifiesRange = /range|too many blocks|limited to [0-9]+ blocks|maximum.*blocks/.test(message);
  const identifiesLimit = /limit|limited|maximum|exceed|too (wide|large|many)/.test(message);
  return identifiesBlockResults && identifiesRange && identifiesLimit;
}

async function fetchLogsAdaptive(input: {
  provider: AbstractProvider;
  rpcPolicy: RpcPolicy;
  addresses: string[];
  fromBlock: number;
  toBlock: number;
  splitDepth?: number;
}): Promise<any[]> {
  const { provider, rpcPolicy, addresses, fromBlock, toBlock, splitDepth = 0 } = input;
  try {
    return await rpcPolicy.request({
      role: 'logs',
      method: 'eth_getLogs',
      operation: () => provider.getLogs({
        address: addresses,
        fromBlock,
        toBlock,
      }),
    });
  } catch (error) {
    if (!isLogRangeLimitError(error) || fromBlock >= toBlock) throw error;
    if (splitDepth >= 32) throw new Error(`Log range split depth exceeded for ${fromBlock}-${toBlock}`, { cause: error });
    const midpoint = Math.floor((fromBlock + toBlock) / 2);
    const left = await fetchLogsAdaptive({
      provider,
      rpcPolicy,
      addresses,
      fromBlock,
      toBlock: midpoint,
      splitDepth: splitDepth + 1,
    });
    const right = await fetchLogsAdaptive({
      provider,
      rpcPolicy,
      addresses,
      fromBlock: midpoint + 1,
      toBlock,
      splitDepth: splitDepth + 1,
    });
    return [...left, ...right];
  }
}

async function fetchChunk(input: {
  canonicalProvider: AbstractProvider;
  logsProvider: AbstractProvider;
  fallbackProvider?: AbstractProvider;
  rpcPolicy: RpcPolicy;
  iface: Interface;
  contractAddresses: string[];
  fromBlock: number;
  toBlock: number;
  interChunkDelayMs: number;
}): Promise<RawEventRow[]> {
  const {
    canonicalProvider,
    logsProvider,
    fallbackProvider,
    rpcPolicy,
    iface,
    contractAddresses,
    fromBlock,
    toBlock,
    interChunkDelayMs,
  } = input;
  const output: RawEventRow[] = [];
  const blockCache = new Map<number, Block>();
  const allowedAddresses = new Set(contractAddresses.map((address) => address.toLowerCase()));

  const rawLogs = await fetchLogsAdaptive({
    provider: logsProvider,
    rpcPolicy,
    addresses: contractAddresses,
    fromBlock,
    toBlock,
  });

  for (const log of rawLogs) {
    if (!allowedAddresses.has(log.address.toLowerCase())) {
      throw new Error(`Logs RPC returned unexpected address ${log.address}`);
    }
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
      const fetched = await rpcPolicy.request({
        role: 'canonical',
        method: 'eth_getBlockByNumber',
        operation: () => canonicalProvider.getBlock(log.blockNumber),
        fallback: fallbackProvider ? () => fallbackProvider.getBlock(log.blockNumber) : undefined,
        fallbackReason: 'log-block-metadata',
      });
      if (!fetched) {
        throw new Error(`Missing canonical block metadata for supported log at block ${log.blockNumber}`);
      }
      block = fetched;
      blockCache.set(log.blockNumber, block);
    }
    if (!block.hash || !log.blockHash || block.hash.toLowerCase() !== String(log.blockHash).toLowerCase()) {
      throw new Error(`Canonical log mismatch at block ${log.blockNumber}`);
    }
    output.push(toRawEventRow({
      log,
      parsed,
      blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    }));
  }

  await sleep(interChunkDelayMs);
  return output.sort((left, right) =>
    left.blockNumber !== right.blockNumber
      ? left.blockNumber - right.blockNumber
      : left.logIndex - right.logIndex);
}

function createDeploymentWiringReader(
  provider: AbstractProvider,
  fallbackProvider: AbstractProvider | undefined,
  rpcPolicy: RpcPolicy,
) {
  const vaultInterface = new Interface(['function drawManager() view returns (address)']);
  const managerInterface = new Interface([
    'function vault() view returns (address)',
    'function claimManager() view returns (address)',
  ]);
  const claimInterface = new Interface(['function authorizedSource(address) view returns (bool)']);
  const read = async (to: string, iface: Interface, method: string, args: unknown[] = []) => {
    const data = iface.encodeFunctionData(method, args);
    const result = await rpcPolicy.request({
      role: 'canonical',
      method: 'eth_call',
      operation: () => provider.call({ to, data }),
      fallback: fallbackProvider ? () => fallbackProvider.call({ to, data }) : undefined,
      fallbackReason: 'deployment-wiring',
    });
    return iface.decodeFunctionResult(method, result);
  };
  return async (deployment: V5DeploymentScope) => {
    const [vaultDrawManager, managerVault, managerClaimManager, sourceAuthorized] = await Promise.all([
      read(deployment.vaultAddress, vaultInterface, 'drawManager'),
      read(deployment.drawManagerAddress, managerInterface, 'vault'),
      read(deployment.drawManagerAddress, managerInterface, 'claimManager'),
      read(deployment.claimManagerAddress, claimInterface, 'authorizedSource', [deployment.drawManagerAddress]),
    ]);
    return {
      vaultDrawManager: String(vaultDrawManager[0]),
      managerVault: String(managerVault[0]),
      managerClaimManager: String(managerClaimManager[0]),
      sourceAuthorized: Boolean(sourceAuthorized[0]),
    };
  };
}

export class InstrumentedJsonRpcProvider extends JsonRpcProvider {
  constructor(
    url: string,
    private readonly role: RpcProviderRole,
    private readonly rpcPolicy: RpcPolicy,
    timeoutMs = 10_000,
  ) {
    const request = new FetchRequest(url);
    request.timeout = timeoutMs;
    super(request);
  }

  override async _send(payload: any): Promise<any[]> {
    const requests = Array.isArray(payload) ? payload : [payload];
    for (const request of requests) this.rpcPolicy.recordWireRequest(this.role, request.method);
    try {
      const responses = await super._send(payload);
      const responseById = new Map(responses.map((response) => [response.id, response]));
      for (const request of requests) {
        const response = responseById.get(request.id);
        if (response && 'error' in response) this.rpcPolicy.recordWireError(this.role, request.method);
      }
      return responses;
    } catch (error) {
      for (const request of requests) this.rpcPolicy.recordWireError(this.role, request.method);
      throw error;
    }
  }
}

function makeProviders(config: RunnerConfig, rpcPolicy: RpcPolicy): {
  canonicalProvider: AbstractProvider;
  logsProvider: AbstractProvider;
  fallbackProvider?: AbstractProvider;
  providersToValidate: AbstractProvider[];
} {
  const timeoutMs = config.rpcTimeoutMs ?? 10_000;
  const canonicalProvider = new InstrumentedJsonRpcProvider(config.rpcUrl, 'canonical', rpcPolicy, timeoutMs);
  const logsProvider = !config.logsRpcUrl || config.logsRpcUrl === config.rpcUrl
    ? canonicalProvider
    : new InstrumentedJsonRpcProvider(config.logsRpcUrl, 'logs', rpcPolicy, timeoutMs);
  const fallbackProvider = config.rpcUrlFallback
    ? new InstrumentedJsonRpcProvider(config.rpcUrlFallback, 'fallback', rpcPolicy, timeoutMs)
    : undefined;
  return {
    canonicalProvider,
    logsProvider,
    fallbackProvider,
    providersToValidate: [...new Set([
      canonicalProvider,
      logsProvider,
      fallbackProvider,
    ].filter(Boolean) as AbstractProvider[])],
  };
}
export async function assertProviderChainId(
  provider: Pick<AbstractProvider, 'getNetwork'>,
  expectedChainId: number,
  label: string
): Promise<void> {
  const network = await withRetry(() => provider.getNetwork());
  const actualChainId = BigInt(network.chainId);
  if (actualChainId !== BigInt(expectedChainId)) {
    throw new Error(
      `${label} chain mismatch: expected ${expectedChainId}, got ${actualChainId.toString()}`
    );
  }
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
        kind: Number(args.kind),
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
