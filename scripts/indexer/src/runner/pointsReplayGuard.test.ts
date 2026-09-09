import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { Interface } from 'ethers';
import type { AbstractProvider } from 'ethers';
import { applySchema } from '../db/database.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import { createIndexerStateRepo } from '../repositories/indexerStateRepo.js';
import { createPointsReplayStateRepo } from '../repositories/pointsReplayStateRepo.js';
import { createV5ClaimProofsRepo, type V5ClaimProofRow } from '../repositories/v5ClaimProofsRepo.js';
import type { DerivePointsService } from '../services/derivePoints.js';
import type { RawEventRow } from '../types/domain.js';
import { POOL_EVENT_ABI } from './abi.js';
import { createIndexerRunner } from './service.js';
import type { RunnerConfig } from './config.js';

const vault = '0x0000000000000000000000000000000000000a01';
const manager = '0x0000000000000000000000000000000000000a02';
const claims = '0x0000000000000000000000000000000000000a03';
const walletA = '0x00000000000000000000000000000000000000aa';
const iface = new Interface(POOL_EVENT_ABI);

type FakeLog = {
  address: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  index: number;
  topics: readonly string[];
  data: string;
};

// Stable per-block hashes: nothing here is testing reorg detection, and a moving hash would
// trip the canonical rewind path and replay for the wrong reason.
const blockHash = (block: number) => `0x${block.toString(16).padStart(64, '0')}`;

function makeLog(block: number, address: string, name: string, args: readonly unknown[]): FakeLog {
  const encoded = iface.encodeEventLog(iface.getEvent(name)!, args);
  return {
    address,
    blockNumber: block,
    blockHash: blockHash(block),
    transactionHash: `0x${(block * 1000).toString(16).padStart(64, '0')}`,
    index: 0,
    topics: encoded.topics,
    data: encoded.data,
  };
}

class FakeProvider {
  head = 101;
  logs: FakeLog[] = [];

  async getBlockNumber(): Promise<number> {
    return this.head;
  }

  async getBlock(blockNumber: number): Promise<{ hash: string; timestamp: number } | null> {
    return { hash: blockHash(blockNumber), timestamp: 1782950400 + blockNumber };
  }

  async getLogs(filter: { address: string; fromBlock: number; toBlock: number }): Promise<FakeLog[]> {
    return this.logs.filter(
      (log) =>
        log.address.toLowerCase() === filter.address.toLowerCase() &&
        log.blockNumber >= Number(filter.fromBlock) &&
        log.blockNumber <= Number(filter.toBlock)
    );
  }
}

const baseConfig: RunnerConfig = {
  rpcUrl: 'http://unused.invalid',
  chainId: 10143,
  poolAddresses: [vault, manager, claims],
  v5Deployments: [{ chainId: 10143, vaultAddress: vault, drawManagerAddress: manager, claimManagerAddress: claims }],
  claimProofIngestSecret: 'a'.repeat(32),
  deployBlock: 100,
  confirmations: 1,
  chunkSize: 10,
  maxBlocksPerSync: 100,
  pollIntervalMs: 1,
  pointsMinQualifyingMon: 100,
  pointsReplayMaxIdleMs: 600_000,
};

const db = new Database(':memory:');
applySchema(db);
const rawEventsRepo = createRawEventsRepo(db);
const indexerStateRepo = createIndexerStateRepo(db);
const pointsReplayStateRepo = createPointsReplayStateRepo(db);
const v5ClaimProofsRepo = createV5ClaimProofsRepo(db);
const provider = new FakeProvider();

let replays = 0;
let upstreamRebuilds = 0;
let failReplay = false;
const countUpstream = () => { upstreamRebuilds += 1; };
const derivePointsService: DerivePointsService = {
  rebuildSettlementPoints() {
    replays += 1;
    if (failReplay) throw new Error('Points formula changed without a versioned migration');
  },
  inputFingerprint: () => 'adr-0049-v1:fingerprint:start=0',
  runWeeklyCheckpoint: () => ({ processed: 0, skipped: false }),
};

function makeRunner(overrides: Partial<RunnerConfig> = {}) {
  return createIndexerRunner({
    config: { ...baseConfig, ...overrides },
    rawEventsRepo,
    indexerStateRepo,
    pointsReplayStateRepo,
    provider: provider as unknown as AbstractProvider,
    deriveRoundsService: { rebuildFromRaw: countUpstream },
    deriveWalletRoundsService: { rebuildFromRaw: countUpstream },
    deriveWalletStatsService: { rebuild: countUpstream },
    deriveV5TranchesService: { rebuildFromRaw: countUpstream },
    derivePointsService,
  });
}

/** Runs one sync at a fresh chain head, so rebuildDerivedState() is reached every time. */
async function syncAtNewHead(runner: { syncOnce: () => Promise<unknown> }): Promise<void> {
  provider.head += 1;
  const before = upstreamRebuilds;
  await runner.syncOnce();
  assert.ok(
    upstreamRebuilds > before,
    'test harness broken: this sync did not reach rebuildDerivedState()'
  );
}

const runner = makeRunner();

// --- the first replay of a process always runs, and reports success ---------------------
provider.logs.push(makeLog(100, vault, 'Deposit', [walletA, 1n]));
await runner.syncOnce();
assert.equal(replays, 1, 'the first cycle of a process must always replay');
let status = await runner.getStatus();
assert.equal(status.points.status, 'ok');
assert.ok(status.points.lastSuccessUnix != null, 'a successful replay must be visible to monitoring');
assert.equal(status.points.lastError, null);
assert.equal(status.points.staleSeconds, 0);

// --- nothing changed: the replay is skipped while everything upstream still rebuilds -----
const upstreamBeforeIdle = upstreamRebuilds;
await syncAtNewHead(runner);
await syncAtNewHead(runner);
assert.equal(replays, 1, 'an empty scan must not re-run the O(draws x wallets) replay');
assert.ok(upstreamRebuilds > upstreamBeforeIdle, 'other derived state must still rebuild every cycle');

// --- a new event forces a replay ---------------------------------------------------------
provider.logs.push(makeLog(provider.head, vault, 'Deposit', [walletA, 2n]));
await syncAtNewHead(runner);
assert.equal(replays, 2, 'a newly ingested event must force a replay');
await syncAtNewHead(runner);
assert.equal(replays, 2, 'and only one replay for it');

// --- a published draw forces a replay even though no event arrived -----------------------
// This is the case a scanner-only "did we insert anything?" check misses: proofs are written
// by the ingest HTTP route, and publishing one changes who counts as a winner.
const proof: V5ClaimProofRow = {
  chainId: 10143,
  vaultAddress: vault,
  drawManagerAddress: manager,
  claimManagerAddress: claims,
  drawId: 1,
  distributionId: `0x${'11'.repeat(32)}`,
  leafIndex: 0,
  account: walletA,
  token: '0x0000000000000000000000000000000000000055',
  amount: '100',
  kind: 0,
  leafHash: `0x${'22'.repeat(32)}`,
  proof: '[]',
  root: `0x${'22'.repeat(32)}`,
  publishedAt: new Date(0).toISOString(),
};
v5ClaimProofsRepo.publishDraw([proof]);
await syncAtNewHead(runner);
assert.equal(replays, 3, 'a published draw must force a replay with no new event');

// An idempotent re-publish writes nothing, so it must not force a replay.
v5ClaimProofsRepo.publishDraw([proof]);
await syncAtNewHead(runner);
assert.equal(replays, 3, 'a no-op re-publish must not force a replay');

// --- an operator touching the points tables forces a replay ------------------------------
// scripts/reset-points-tables.ts truncates these without touching raw events or proofs.
db.prepare("INSERT INTO wallet_points (wallet, lifetime_points, updated_at) VALUES ('0xdead', 7, 1)").run();
await syncAtNewHead(runner);
assert.equal(replays, 4, 'points-table rows appearing out of band must force a replay');
db.prepare('DELETE FROM wallet_points').run();
await syncAtNewHead(runner);
assert.equal(replays, 5, 'a points reset must force a replay');

// --- raw-event writes that leave row counts identical still force a replay ---------------
// A rewind deletes a block range and writes it back. Row counts, MAX(rowid) and even the
// contents can come back identical, so the guard counts writes rather than inspecting rows.
const existing: RawEventRow[] = rawEventsRepo.getRange(100, 100);
assert.equal(existing.length, 1, 'test harness broken: expected the block-100 deposit');
rawEventsRepo.upsertMany(existing);
await syncAtNewHead(runner);
assert.equal(replays, 6, 'rewriting identical raw rows must force a replay');

rawEventsRepo.deleteFromBlock(100);
await syncAtNewHead(runner);
assert.equal(replays, 7, 'deleting raw rows must force a replay');

// --- a failing replay must not make the rest of the indexer look broken ------------------
const originalError = console.error;
const errorLines: string[] = [];
console.error = (...args: unknown[]) => { errorLines.push(String(args[0])); };
try {
  failReplay = true;
  const cursorBefore = (await runner.getStatus()).lastScannedBlock;
  provider.logs.push(makeLog(provider.head, vault, 'Deposit', [walletA, 3n]));
  await syncAtNewHead(runner); // must resolve, not throw
  assert.equal(replays, 8);
  status = await runner.getStatus();
  assert.ok(status.lastScannedBlock > cursorBefore, 'ingestion must keep advancing');
} finally {
  console.error = originalError;
}
assert.equal(errorLines.length, 1, 'a points failure must log exactly once per attempt');
assert.match(errorLines[0], /\[indexer\]\[points\]/, 'points failures must be distinguishable from sync failures');

status = await runner.getStatus();
assert.equal(status.points.status, 'degraded');
assert.match(status.points.lastError ?? '', /versioned migration/);
assert.ok(status.points.lastErrorUnix != null);
assert.ok(status.points.lastSuccessUnix != null, 'the last good rebuild must stay visible while degraded');

// The guard must not delete the fingerprint or reset awards to recover: the stored signature
// is left alone so the next attempt is a retry, not a skip.
assert.ok(pointsReplayStateRepo.read().signature != null, 'the last good signature must survive a failure');

// --- a persistent failure backs off instead of becoming a hot retry loop -----------------
const replaysWhileDegraded = replays;
console.error = () => {};
try {
  await syncAtNewHead(runner);
} finally {
  console.error = originalError;
}
assert.equal(replays, replaysWhileDegraded, 'a failed replay must back off before retrying');
assert.equal((await runner.getStatus()).points.status, 'degraded', 'and stay visibly degraded');

// --- a failure is retried, not latched ---------------------------------------------------
// Same process, backstop disabled: the next cycle retries immediately.
const eagerRunner = makeRunner({ pointsReplayMaxIdleMs: 0 });
console.error = () => {};
try {
  await syncAtNewHead(eagerRunner);
  assert.equal(replays, 9, 'a recorded failure must be retried');
} finally {
  console.error = originalError;
}
failReplay = false;
await syncAtNewHead(eagerRunner);
assert.equal(replays, 10);
status = await eagerRunner.getStatus();
assert.equal(status.points.status, 'ok', 'a successful retry must clear the degraded status');
assert.equal(status.points.lastError, null);
assert.equal(status.points.lastErrorUnix, null);

// With the backstop disabled the replay runs unconditionally -- the escape hatch back to the
// previous behaviour.
await syncAtNewHead(eagerRunner);
assert.equal(replays, 11, 'POINTS_REPLAY_MAX_IDLE_MS=0 must disable the guard entirely');

// --- a restart always replays, whatever the stored signature says ------------------------
// This is what covers a code or config change that alters the formula without touching data.
const restarted = makeRunner();
await syncAtNewHead(restarted);
assert.equal(replays, 12, 'a fresh process must replay even when the signature matches');
await syncAtNewHead(restarted);
assert.equal(replays, 12, 'and then settle back to skipping');

// --- points health is reported separately from ingestion health --------------------------
const noPoints = createIndexerRunner({
  config: baseConfig,
  rawEventsRepo,
  indexerStateRepo,
  provider: provider as unknown as AbstractProvider,
  deriveRoundsService: { rebuildFromRaw() {} },
  deriveWalletRoundsService: { rebuildFromRaw() {} },
  deriveWalletStatsService: { rebuild() {} },
  deriveV5TranchesService: { rebuildFromRaw() {} },
});
assert.equal((await noPoints.getStatus()).points.status, 'disabled');

db.close();
console.log('pointsReplayGuard.test.ts ok');
