import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createPointsRepo } from '../repositories/pointsRepo.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import { createRoundsRepo } from '../repositories/roundsRepo.js';
import { createV5ClaimProofsRepo } from '../repositories/v5ClaimProofsRepo.js';
import { createV5TranchesRepo } from '../repositories/v5TranchesRepo.js';
import { createWalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import type { RawEventRow, V5DeploymentScope } from '../types/domain.js';
import { createDerivePointsService } from '../services/derivePoints.js';
import { createDeriveV5TranchesService } from '../services/deriveV5Tranches.js';
import { POINTS_FORMULA_VERSION } from '../services/pointsMath.js';

const vault = '0x0000000000000000000000000000000000000011';
const manager = '0x0000000000000000000000000000000000000022';
const claims = '0x0000000000000000000000000000000000000033';
const wallet = '0x00000000000000000000000000000000000000aa';
const scope: V5DeploymentScope = { chainId: 10143, vaultAddress: vault, drawManagerAddress: manager, claimManagerAddress: claims };
const MON = 10n ** 18n;
const SIX_HOURS = 21_600;
const start = 1_800_000_000;
const iso = (unix: number) => new Date(unix * 1000).toISOString();

function context() {
  const db = new Database(':memory:');
  applySchema(db);
  const rawEventsRepo = createRawEventsRepo(db);
  const roundsRepo = createRoundsRepo(db);
  const walletRoundsRepo = createWalletRoundsRepo(db);
  const pointsRepo = createPointsRepo(db);
  const v5TranchesRepo = createV5TranchesRepo(db);
  const claimProofsRepo = createV5ClaimProofsRepo(db);
  const deriveTranches = createDeriveV5TranchesService(rawEventsRepo, v5TranchesRepo, walletRoundsRepo, [scope]);
  const derivePoints = createDerivePointsService({
    pointsRepo, roundsRepo, walletRoundsRepo, v5ClaimProofsRepo: claimProofsRepo,
    pointsStartUnix: 0, minQualifyingWei: (100n * MON).toString(),
  });
  return {
    db,
    rawEventsRepo,
    roundsRepo,
    walletRoundsRepo,
    pointsRepo,
    claimProofsRepo,
    deriveTranches,
    derivePoints,
  };
}

function raw(input: {
  eventName: RawEventRow['eventName']; logIndex: number; unix: number;
  contractAddress?: string; roundId?: number; payload: Record<string, unknown>;
}): RawEventRow {
  return {
    txHash: '0x' + input.logIndex.toString(16).padStart(64, '0'),
    logIndex: input.logIndex,
    blockNumber: 100 + input.logIndex,
    blockHash: '0x' + input.logIndex.toString(16).padStart(64, '1'),
    blockTimestamp: iso(input.unix),
    contractAddress: input.contractAddress ?? manager,
    eventName: input.eventName,
    roundId: input.roundId ?? null,
    wallet: null,
    amountMon: null,
    payload: JSON.stringify(input.payload),
    finalized: 1,
    createdAt: iso(input.unix),
  };
}

function addDraw(ctx: ReturnType<typeof context>, drawId: number, periodStart: number, settledUnix: number) {
  const periodEnd = periodStart + SIX_HOURS;
  ctx.rawEventsRepo.upsertMany([raw({
    eventName: 'DrawStarted', logIndex: drawId, unix: periodStart, roundId: drawId,
    payload: { drawId, periodStart: String(periodStart), periodEnd: String(periodEnd) },
  })]);
  ctx.roundsRepo.upsert({
    roundId: drawId, poolAddress: manager, state: 'settled', isSkipped: 0,
    openedAt: iso(periodStart), salesEndTime: iso(periodEnd), committedAt: null,
    drawnAt: null, unstakingAt: null, settledAt: iso(settledUnix),
    depositTotalMon: '0', monReceived: '0', yieldMon: '0', lossRatio: '0',
    ticketCount: 0, uniqueWalletCount: 0, winnerWalletsCount: 0, winner: null,
    winningTicket: null, updatedAt: iso(settledUnix),
  });
}

function position(eventName: 'Deposit' | 'Withdraw' | 'BoostDeposit' | 'BoostWithdraw', logIndex: number, unix: number, amount: bigint): RawEventRow {
  const patron = eventName.startsWith('Boost');
  return raw({
    eventName, logIndex, unix, contractAddress: vault,
    payload: { [patron ? 'booster' : 'recipient']: wallet, amount: amount.toString() },
  });
}

function rebuild(ctx: ReturnType<typeof context>) {
  ctx.walletRoundsRepo.deleteAll();
  ctx.deriveTranches.rebuildFromRaw();
  ctx.derivePoints.rebuildSettlementPoints();
}

function history(ctx: ReturnType<typeof context>, drawId: number) {
  const row = ctx.pointsRepo.listHistory(wallet, 100).find((item) => item.roundId === drawId);
  assert.ok(row, 'missing points row for draw ' + drawId);
  return { row, bonuses: JSON.parse(row.bonusesBreakdown) as Record<string, number> };
}


// Helpers and boundary scenarios are based on the independent R-303-01 reproduction.
for (const method of ['withdraw', 'transfer'] as const) {
  for (const oldCount of [1, 4]) {
    for (const boundaryOffset of [0, 1]) {
      for (const reverseSettlement of [false, true]) {
        const ctx = context();
        const end = start + oldCount * SIX_HOURS;
        const name = `${method}, ${oldCount} old draws, offset ${boundaryOffset}, reverse ${reverseSettlement}`;
        for (let id = 1; id <= oldCount; id++) {
          addDraw(ctx, id, start + (id - 1) * SIX_HOURS,
            end + 600 + (reverseSettlement ? oldCount - id : id));
        }
        const exitUnix = end + boundaryOffset;
        ctx.rawEventsRepo.upsertMany([
          position('Deposit', 100, start, 100n * MON),
          method === 'withdraw'
            ? position('Withdraw', 101, exitUnix, 100n * MON)
            : raw({ eventName: 'Transfer', logIndex: 101, unix: exitUnix, contractAddress: vault,
                payload: { from: wallet, to: '0x' + 'bb'.repeat(20), amount: (100n * MON).toString() } }),
          position('Deposit', 102, exitUnix + 1, 100n * MON),
        ]);
        rebuild(ctx);
        const oldPoints = ctx.pointsRepo.getProfile(wallet)!.lifetimePoints;
        assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 0, `${name}: fresh position is not old participation`);
        assert.equal(ctx.pointsRepo.getProfile(wallet)!.longestStreakWeeks, oldCount, `${name}: preserve historical record`);
        assert.equal(oldPoints, oldCount === 4 ? 18_220 : 2_680, `${name}: preserve historically earned awards`);
        for (let id = oldCount + 1; id <= oldCount + 9; id++) {
          addDraw(ctx, id, start + (id - 1) * SIX_HOURS, start + id * SIX_HOURS + 600);
        }
        rebuild(ctx);
        assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 9, `${name}: only nine new draws count`);
        assert.equal(ctx.pointsRepo.getProfile(wallet)!.longestStreakWeeks, 9, `${name}: historical best advances normally`);
        assert.equal(ctx.pointsRepo.getProfile(wallet)!.highestStreakMilestoneAwarded, 4, `${name}: no early thirteen-draw milestone`);
        assert.equal(history(ctx, oldCount + 9).bonuses.streak_milestone, undefined, `${name}: no early 20k award`);
        const beforeReplay = ctx.pointsRepo.listHistory(wallet, 100);
        rebuild(ctx);
        assert.deepEqual(ctx.pointsRepo.listHistory(wallet, 100), beforeReplay, `${name}: deterministic replay`);
        ctx.db.close();
      }
    }
  }
}


for (const method of ['withdraw', 'transfer'] as const) {
  for (const reenterDuringPeriod of [false, true]) {
    const ctx = context();
    const end = start + SIX_HOURS;
    addDraw(ctx, 1, start, end + 600);
    ctx.rawEventsRepo.upsertMany([
      position('Deposit', 100, start, 100n * MON),
      method === 'withdraw' ? position('Withdraw', 101, end - 2, 100n * MON)
        : raw({ eventName: 'Transfer', logIndex: 101, unix: end - 2, contractAddress: vault,
            payload: { from: wallet, to: '0x' + 'bb'.repeat(20), amount: (100n * MON).toString() } }),
      position('Deposit', 102, reenterDuringPeriod ? end - 1 : end + 1, 100n * MON),
    ]);
    rebuild(ctx);
    assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, reenterDuringPeriod ? 1 : 0,
      `${method}: only a re-entry that actually earns in this period is active participation`);
    assert.ok(ctx.pointsRepo.getProfile(wallet)!.lifetimePoints > 0, 'historical participation remains earned');
    ctx.db.close();
  }
}

{
  const ctx = context();
  const end = start + 4 * SIX_HOURS;
  for (let id = 1; id <= 4; id++) addDraw(ctx, id, start + (id - 1) * SIX_HOURS, end + 600 + id);
  ctx.rawEventsRepo.upsertMany([
    position('Deposit', 100, start, 100n * MON), position('Withdraw', 101, end + 1, 40n * MON),
    position('Deposit', 102, end + 2, 40n * MON),
  ]);
  rebuild(ctx);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 4, 'partial exit preserves old active streak');
  ctx.db.close();
}

console.log('derivePointsDelayedReentry.test.ts ok (21 backlog, boundary and partial-exit fixtures)');
