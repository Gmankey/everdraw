import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createRoundsRepo } from '../repositories/roundsRepo.js';
import { createWalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import { createPointsRepo } from '../repositories/pointsRepo.js';
import { createDerivePointsService } from './derivePoints.js';

const wallet = '0x00000000000000000000000000000000000000aa';
const otherWallet = '0x00000000000000000000000000000000000000bb';
const pool = '0x00000000000000000000000000000000000000a1';

function context() {
  const db = new Database(':memory:');
  applySchema(db);
  const roundsRepo = createRoundsRepo(db);
  const walletRoundsRepo = createWalletRoundsRepo(db);
  const pointsRepo = createPointsRepo(db);
  const service = createDerivePointsService({ pointsRepo, roundsRepo, walletRoundsRepo });
  return { db, roundsRepo, walletRoundsRepo, pointsRepo, service };
}

function round(
  ctx: ReturnType<typeof context>,
  roundId: number,
  state: 'open' | 'settled' | 'skipped',
  settledAt: string | null,
  winner: string | null = null,
) {
  ctx.roundsRepo.upsert({
    roundId,
    poolAddress: pool,
    state,
    isSkipped: state === 'skipped' ? 1 : 0,
    openedAt: `2026-05-${String(roundId).padStart(2, '0')}T00:00:00.000Z`,
    salesEndTime: `2026-05-${String(roundId).padStart(2, '0')}T01:00:00.000Z`,
    committedAt: null,
    drawnAt: null,
    unstakingAt: null,
    settledAt,
    depositTotalMon: '0',
    monReceived: '0',
    yieldMon: '0',
    lossRatio: '0',
    ticketCount: 0,
    uniqueWalletCount: 0,
    winnerWalletsCount: winner ? 1 : 0,
    winner,
    winningTicket: null,
    updatedAt: new Date().toISOString(),
  });
}

function wr(ctx: ReturnType<typeof context>, roundId: number, tickets: number, won: 0 | 1 = 0, w = wallet) {
  ctx.walletRoundsRepo.upsert({
    wallet: w,
    roundId,
    poolAddress: pool,
    tickets,
    monPaid: String(tickets),
    won,
    withdrew: 0,
    prizeClaimed: '0',
    principalWithdrawn: '0',
    withdrawnAt: null,
    netPosition: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function bonuses(ctx: ReturnType<typeof context>, roundId: number, w = wallet): Record<string, number> {
  const row = ctx.pointsRepo.listHistory(w, 100).find((item) => item.roundId === roundId);
  assert.ok(row, `missing points row for round ${roundId}`);
  return JSON.parse(row.bonusesBreakdown) as Record<string, number>;
}

{
  const ctx = context();
  round(ctx, 1, 'settled', '2026-05-03T00:00:00.000Z');
  wr(ctx, 1, 10, 0);

  ctx.service.rebuildSettlementPoints();

  const [row] = ctx.pointsRepo.listHistory(wallet, 10);
  assert.equal(row.basePoints, 10);
  assert.equal(row.totalPoints, 25_010);
  assert.deepEqual(bonuses(ctx, 1), { first_deposit: 25_000 });
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.consecutiveNonWins, 1);
}

{
  const ctx = context();
  for (let id = 1; id <= 10; id += 1) {
    round(ctx, id, 'settled', `2026-05-${String(id + 2).padStart(2, '0')}T00:00:00.000Z`);
    wr(ctx, id, 1, 0);
  }

  ctx.service.rebuildSettlementPoints();

  assert.equal(bonuses(ctx, 10).loss_streak, 50_000);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.highestLossStreakBonusAwarded, 10);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.consecutiveNonWins, 10);
}

{
  const ctx = context();
  round(ctx, 1, 'settled', '2026-05-03T00:00:00.000Z');
  wr(ctx, 1, 1, 0);
  round(ctx, 2, 'settled', '2026-05-04T00:00:00.000Z');
  round(ctx, 3, 'settled', '2026-05-05T00:00:00.000Z');
  round(ctx, 4, 'settled', '2026-05-06T00:00:00.000Z');
  wr(ctx, 4, 1, 0);
  round(ctx, 5, 'settled', '2026-05-07T00:00:00.000Z');
  round(ctx, 6, 'settled', '2026-05-08T00:00:00.000Z');
  round(ctx, 7, 'settled', '2026-05-09T00:00:00.000Z');
  wr(ctx, 7, 1, 0);

  ctx.service.rebuildSettlementPoints();

  assert.equal(bonuses(ctx, 4).comeback_king, 100_000);
  assert.equal(bonuses(ctx, 7).comeback_king, 100_000);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.consecutiveMissedDraws, 0);
}

{
  const ctx = context();
  round(ctx, 1, 'settled', '2026-05-03T00:00:00.000Z');
  wr(ctx, 1, 1, 0);
  round(ctx, 2, 'skipped', '2026-05-04T00:00:00.000Z');
  wr(ctx, 2, 2, 0);
  round(ctx, 3, 'settled', '2026-05-05T00:00:00.000Z');
  wr(ctx, 3, 3, 0);

  ctx.service.rebuildSettlementPoints();

  const skippedRow = ctx.pointsRepo.listHistory(wallet, 10).find((row) => row.roundId === 2)!;
  assert.equal(skippedRow.basePoints, 2);
  assert.equal(skippedRow.totalPoints, 2);
  assert.equal(bonuses(ctx, 3).comeback_king, undefined);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.consecutiveNonWins, 3);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.consecutiveMissedDraws, 0);
}

{
  const ctx = context();
  round(ctx, 1, 'settled', '2026-05-03T00:00:00.000Z');
  wr(ctx, 1, 1, 0);
  round(ctx, 2, 'open', null);
  wr(ctx, 2, 1, 0);

  ctx.service.rebuildSettlementPoints();
  const profile = ctx.pointsRepo.getProfile(wallet)!;
  ctx.pointsRepo.upsertWalletStreak({
    ...profile,
    currentStreakWeeks: 3,
    longestStreakWeeks: 3,
    lastCheckpointUnix: 0,
    consecutiveNonWins: 1,
    consecutiveMissedDraws: 0,
    updatedAt: 1,
  });

  const partial = ctx.service.runWeeklyCheckpoint(Date.parse('2026-05-10T00:00:00.000Z') / 1000);
  assert.equal(partial.skipped, false);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 4);

  ctx.pointsRepo.ensureWallet(otherWallet, 1);
  ctx.pointsRepo.upsertWalletStreak({
    wallet: otherWallet,
    currentStreakWeeks: 3,
    longestStreakWeeks: 3,
    lastCheckpointUnix: 0,
    consecutiveNonWins: 0,
    consecutiveMissedDraws: 0,
    updatedAt: 1,
  });
  wr(ctx, 1, 1, 0, otherWallet);

  const full = ctx.service.runWeeklyCheckpoint(Date.parse('2026-05-10T00:00:00.000Z') / 1000);
  assert.equal(full.skipped, false);
  assert.equal(ctx.pointsRepo.getProfile(otherWallet)!.currentStreakWeeks, 0);
}

{
  const ctx = context();
  round(ctx, 1, 'settled', '2026-05-03T00:00:00.000Z');
  wr(ctx, 1, 1, 0);
  ctx.db.prepare(`
    INSERT INTO v5_position_events (
      tx_hash, log_index, block_number, block_timestamp, vault_address, wallet,
      pool_type, action, amount, balance_after, raw_event_name
    ) VALUES (
      '0x00000000000000000000000000000000000000000000000000000000000000dd',
      1,
      100,
      '2026-05-02T00:00:00.000Z',
      ?,
      ?,
      'degen',
      'deposit',
      '100',
      '100',
      'BoostDeposit'
    )
  `).run(pool, wallet);

  ctx.service.rebuildSettlementPoints();

  assert.equal(bonuses(ctx, 1).prize_patron, 25_000);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.hasReceivedPrizePatronBonus, 1);
}

{
  const ctx = context();
  const checkpointUnix = Date.parse('2026-05-01T00:00:00.000Z') / 1000;
  ctx.pointsRepo.ensureWallet(wallet, checkpointUnix);
  ctx.pointsRepo.ensureWallet(otherWallet, checkpointUnix);
  ctx.pointsRepo.upsertWalletStreak({
    wallet,
    currentStreakWeeks: 26,
    longestStreakWeeks: 52,
    lastCheckpointUnix: checkpointUnix,
    consecutiveNonWins: 7,
    consecutiveMissedDraws: 3,
    updatedAt: checkpointUnix,
  });
  ctx.pointsRepo.upsertWalletStreak({
    wallet: otherWallet,
    currentStreakWeeks: 26,
    longestStreakWeeks: 52,
    lastCheckpointUnix: checkpointUnix,
    consecutiveNonWins: 7,
    consecutiveMissedDraws: 3,
    updatedAt: checkpointUnix,
  });
  const insertExit = ctx.db.prepare(`
    INSERT INTO v5_position_events (
      tx_hash, log_index, block_number, block_timestamp, vault_address, wallet,
      pool_type, action, amount, balance_after, raw_event_name
    ) VALUES (?, 1, 100, '2026-05-02T00:00:00.000Z', ?, ?, 'vault', 'withdraw', '100', ?, 'Withdraw')
  `);
  insertExit.run(
    '0x00000000000000000000000000000000000000000000000000000000000000ee',
    pool,
    wallet,
    '0',
  );
  insertExit.run(
    '0x00000000000000000000000000000000000000000000000000000000000000ef',
    pool,
    otherWallet,
    '1',
  );

  ctx.service.rebuildSettlementPoints();

  const reset = ctx.pointsRepo.getProfile(wallet)!;
  assert.equal(reset.currentStreakWeeks, 0, 'a full V5 vault exit resets the current streak immediately');
  assert.equal(reset.longestStreakWeeks, 52, 'a full exit preserves the historical longest streak');
  const partial = ctx.pointsRepo.getProfile(otherWallet)!;
  assert.equal(partial.currentStreakWeeks, 26, 'a partial V5 vault exit preserves the current streak');
}

console.log('derivePoints.test.ts ok');
