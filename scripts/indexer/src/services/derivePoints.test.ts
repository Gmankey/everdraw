import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createRoundsRepo } from '../repositories/roundsRepo.js';
import { createWalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import { createPointsRepo } from '../repositories/pointsRepo.js';
import { createV5ClaimProofsRepo } from '../repositories/v5ClaimProofsRepo.js';
import { createV5TranchesRepo } from '../repositories/v5TranchesRepo.js';
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
  const v5ClaimProofsRepo = createV5ClaimProofsRepo(db);
  const v5TranchesRepo = createV5TranchesRepo(db);
  const service = createDerivePointsService({
    pointsRepo,
    roundsRepo,
    walletRoundsRepo,
    v5ClaimProofsRepo,
  });
  return { db, roundsRepo, walletRoundsRepo, pointsRepo, v5ClaimProofsRepo, v5TranchesRepo, service };
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
  assert.equal(row.totalPoints, 2_510);
  assert.deepEqual(bonuses(ctx, 1), { first_deposit: 2_500 });
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.consecutiveNonWins, 1);
}

{
  const ctx = context();
  for (let id = 1; id <= 10; id += 1) {
    round(ctx, id, 'settled', `2026-05-${String(id + 2).padStart(2, '0')}T00:00:00.000Z`);
    wr(ctx, id, 1, 0);
  }

  ctx.service.rebuildSettlementPoints();

  assert.equal(bonuses(ctx, 10).loss_streak, 5_000);
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

  assert.equal(bonuses(ctx, 4).comeback_king, 10_000, 'first genuine comeback is awarded');
  // ADR-0049 §2 — Comeback King is now ONE-TIME. It was previously repeatable, which made
  // "exit -> miss 2 draws -> rejoin" an unbounded farming loop worth 100,000 per cycle.
  assert.equal(
    bonuses(ctx, 7).comeback_king,
    undefined,
    'a second comeback must NOT be awarded: the bonus is one-time per wallet',
  );
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
  assert.equal(skippedRow.totalPoints, 5_002, 'a held skipped draw advances the streak and earns the draw-2 milestone');
  assert.equal(bonuses(ctx, 3).comeback_king, undefined);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.consecutiveNonWins, 3);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.consecutiveMissedDraws, 0);
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

  assert.equal(bonuses(ctx, 1).prize_patron, 2_500);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.hasReceivedPrizePatronBonus, 1);
}



{
  const ctx = context();
  round(ctx, 1, 'skipped', '2026-05-03T00:00:00.000Z');
  wr(ctx, 1, 0);
  ctx.walletRoundsRepo.upsertV5ResolvedBase(wallet, 1, pool, 5);
  ctx.v5TranchesRepo.insertTranche({
    wallet,
    vaultAddress: pool,
    poolType: 'vault',
    amount: '100',
    remainingAmount: '100',
    openedBlockNumber: 1,
    openedLogIndex: 1,
    openedAt: '2026-05-01T00:00:00.000Z',
    openedTxHash: '0x00000000000000000000000000000000000000000000000000000000000000a1',
    startDrawId: 1,
    closedAt: null,
    closedBlockNumber: null,
    closedLogIndex: null,
    closedTxHash: null,
  });
  const fromUnix = Date.parse('2026-05-01T00:00:00.000Z') / 1000;
  const checkpointUnix = Date.parse('2026-05-04T00:00:00.000Z') / 1000;
  const result = ctx.service.runWeeklyCheckpoint(checkpointUnix, fromUnix);
  assert.equal(result.skipped, false);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 1);
}


{
  const ctx = context();
  round(ctx, 1, 'settled', '2026-05-03T00:00:00.000Z');
  wr(ctx, 1, 1);
  ctx.v5ClaimProofsRepo.publishDraw([{
    chainId: 10143,
    vaultAddress: pool,
    drawManagerAddress: pool,
    claimManagerAddress: '0x00000000000000000000000000000000000000c1',
    drawId: 1,
    distributionId: '0x' + '11'.repeat(32),
    leafIndex: 0,
    account: wallet,
    token: '0x00000000000000000000000000000000000000d1',
    amount: '100',
    kind: 0,
    leafHash: '0x' + '22'.repeat(32),
    proof: '[]',
    root: '0x' + '33'.repeat(32),
    publishedAt: '2026-05-03T00:00:00.000Z',
  }]);
  ctx.service.rebuildSettlementPoints();
  assert.equal(bonuses(ctx, 1).win, 2_500);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.hasReceivedFirstWinBonus, 1);
}

{
  const ctx = context();
  for (let id = 1; id <= 12; id += 1) {
    const settledAt = new Date(Date.UTC(2026, 4, id + 2)).toISOString();
    round(ctx, id, 'settled', settledAt);
    if (id <= 9 || id === 12) wr(ctx, id, 1, 0);
  }
  ctx.v5TranchesRepo.insertTranche({
    wallet,
    vaultAddress: pool,
    poolType: 'vault',
    amount: '100',
    remainingAmount: '0',
    openedBlockNumber: 1,
    openedLogIndex: 1,
    openedAt: '2026-05-01T00:00:00.000Z',
    openedTxHash: '0x0000000000000000000000000000000000000000000000000000000000000f01',
    startDrawId: 1,
    closedAt: '2026-05-11T12:00:00.000Z',
    closedBlockNumber: 100,
    closedLogIndex: 1,
    closedTxHash: '0x0000000000000000000000000000000000000000000000000000000000000f02',
  });

  ctx.service.rebuildSettlementPoints();

  assert.equal(bonuses(ctx, 12).loss_streak, undefined, 'a full exit resets the pre-exit loss streak');
  assert.equal(bonuses(ctx, 12).comeback_king, 10_000, 'two genuinely absent draws still earn Comeback King');
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.consecutiveNonWins, 1);
}


console.log('derivePoints.test.ts ok');
