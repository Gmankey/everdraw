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
import { createDerivePointsService } from './derivePoints.js';
import { createDeriveV5TranchesService } from './deriveV5Tranches.js';
import { POINTS_FORMULA_VERSION } from './pointsMath.js';

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
  return { db, rawEventsRepo, roundsRepo, walletRoundsRepo, pointsRepo, deriveTranches, derivePoints };
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

// P-02: boosted Patron entries cannot turn 50 MON into a qualifying 100 MON position.
{
  const ctx = context();
  addDraw(ctx, 1, start, start + SIX_HOURS + 60);
  ctx.rawEventsRepo.upsertMany([position('BoostDeposit', 10, start, 50n * MON)]);
  rebuild(ctx);
  const result = history(ctx, 1);
  assert.equal(result.row.basePoints, 180);
  assert.equal(result.bonuses.first_deposit, undefined);
  assert.equal(result.bonuses.prize_patron, undefined);
}

// P-03: topping up after the earning period cannot qualify the earlier draw or milestone.
{
  const ctx = context();
  addDraw(ctx, 1, start, start + SIX_HOURS + 60);
  addDraw(ctx, 2, start + SIX_HOURS, start + 2 * SIX_HOURS + 60);
  ctx.rawEventsRepo.upsertMany([
    position('Deposit', 10, start, 1n * MON),
    position('Deposit', 11, start + 2 * SIX_HOURS, 99n * MON),
  ]);
  rebuild(ctx);
  const second = history(ctx, 2);
  assert.equal(second.bonuses.streak_milestone, undefined);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 2);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.highestStreakMilestoneAwarded, 0);
}

// Tied settlements both count, later withdrawals do not rewrite historical eligibility,
// and removing a canonical draw removes its milestone and streak effect.
{
  const ctx = context();
  const sameSettlement = start + 2 * SIX_HOURS + 60;
  addDraw(ctx, 1, start, sameSettlement);
  addDraw(ctx, 2, start + SIX_HOURS, sameSettlement);
  ctx.rawEventsRepo.upsertMany([
    position('Deposit', 10, start, 100n * MON),
    position('Withdraw', 11, start + 2 * SIX_HOURS, 99n * MON),
  ]);
  rebuild(ctx);
  const before = history(ctx, 2);
  assert.equal(before.bonuses.streak_milestone, 5_000);
  assert.equal(before.row.formulaVersion, POINTS_FORMULA_VERSION);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 2);
  const totalBefore = ctx.pointsRepo.getProfile(wallet)!.lifetimePoints;
  rebuild(ctx);
  assert.equal(history(ctx, 2).bonuses.streak_milestone, 5_000);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.lifetimePoints, totalBefore);

  ctx.db.exec('CREATE TRIGGER fail_points_replay BEFORE INSERT ON wallet_round_points WHEN NEW.round_id = 2 BEGIN SELECT RAISE(ABORT, "forced replay failure"); END');
  assert.throws(() => rebuild(ctx), /forced replay failure/);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.lifetimePoints, totalBefore);
  assert.equal(ctx.pointsRepo.listHistory(wallet, 100).length, 2);
  ctx.db.exec('DROP TRIGGER fail_points_replay');

  ctx.db.prepare('DELETE FROM raw_events WHERE event_name = ? AND round_id = ?').run('DrawStarted', 2);
  ctx.db.prepare('DELETE FROM rounds WHERE round_id = ? AND LOWER(pool_address) = LOWER(?)').run(2, manager);
  rebuild(ctx);
  assert.equal(ctx.pointsRepo.listHistory(wallet, 100).some((row) => row.roundId === 2), false);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.highestStreakMilestoneAwarded, 0);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 1);
  assert.ok(ctx.pointsRepo.getProfile(wallet)!.lifetimePoints < totalBefore);
}

// A formula mutation fails before historical rows are erased.
{
  const ctx = context();
  addDraw(ctx, 1, start, start + SIX_HOURS + 60);
  ctx.rawEventsRepo.upsertMany([position('Deposit', 10, start, 100n * MON)]);
  rebuild(ctx);
  const total = ctx.pointsRepo.getProfile(wallet)!.lifetimePoints;
  ctx.db.prepare('UPDATE points_formula_registry SET fingerprint = ? WHERE formula_version = ?')
    .run('tampered', POINTS_FORMULA_VERSION);
  assert.throws(() => ctx.derivePoints.rebuildSettlementPoints(), /changed without a versioned migration/);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.lifetimePoints, total);
}

console.log('derivePointsCanonicalReplay.test.ts ok');
