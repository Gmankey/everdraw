import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createRoundsRepo } from '../repositories/roundsRepo.js';
import { createWalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import { createPointsRepo } from '../repositories/pointsRepo.js';
import { createV5TranchesRepo } from '../repositories/v5TranchesRepo.js';
import { createDerivePointsService } from './derivePoints.js';
// Repository-level regressions for V5 position detection, full-exit boundaries,
// and the compatibility replay entry point.
const wallet = '0x00000000000000000000000000000000000000cc';
const vault = '0x00000000000000000000000000000000000000a1';

function context() {
  const db = new Database(':memory:');
  applySchema(db);
  const roundsRepo = createRoundsRepo(db);
  const walletRoundsRepo = createWalletRoundsRepo(db);
  const pointsRepo = createPointsRepo(db);
  const v5TranchesRepo = createV5TranchesRepo(db);
  const service = createDerivePointsService({ pointsRepo, roundsRepo, walletRoundsRepo });
  return { db, roundsRepo, walletRoundsRepo, pointsRepo, v5TranchesRepo, service };
}

function v5Round(ctx: ReturnType<typeof context>, roundId: number, settledAt: string) {
  ctx.roundsRepo.upsert({
    roundId,
    poolAddress: vault,
    state: 'settled',
    isSkipped: 0,
    openedAt: null,
    salesEndTime: null,
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
    winnerWalletsCount: 0,
    winner: null,
    winningTicket: null,
    updatedAt: new Date().toISOString(),
  });
}

{
  const ctx = context();
  v5Round(ctx, 1, '2026-05-03T00:00:00.000Z');

  // A V5 wallet-round: tickets=0 (never set for V5), v5_resolved_base carries the entries.
  ctx.walletRoundsRepo.upsert({
    wallet,
    roundId: 1,
    poolAddress: vault,
    tickets: 0,
    monPaid: '0',
    won: 0,
    withdrew: 0,
    prizeClaimed: '0',
    principalWithdrawn: '0',
    withdrawnAt: null,
    netPosition: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  ctx.walletRoundsRepo.upsertV5ResolvedBase(wallet, 1, vault, 12.5);

  // listWalletsWithDeposits must now find this V5-only wallet.
  assert.deepEqual(ctx.pointsRepo.listWalletsWithDeposits(), [wallet]);

  // An open tranche as of the checkpoint instant -- the V5-native "do you hold a position" signal.
  ctx.v5TranchesRepo.insertTranche({
    wallet,
    vaultAddress: vault,
    poolType: 'vault',
    amount: '10000000000000000000',
    remainingAmount: '10000000000000000000',
    openedBlockNumber: 100,
    openedLogIndex: 0,
    openedAt: '2026-05-01T00:00:00.000Z',
    openedTxHash: '0xabc',
    startDrawId: 1,
    closedAt: null,
    closedBlockNumber: null,
    closedLogIndex: null,
    closedTxHash: null,
  });

  const checkpointUnix = Date.parse('2026-05-10T00:00:00.000Z') / 1000;
  assert.equal(ctx.pointsRepo.hasActivePositionAt(wallet, checkpointUnix), true);

  const result = ctx.service.runWeeklyCheckpoint(checkpointUnix);
  assert.equal(result.skipped, false);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 1, 'V5 wallet streak should advance, not stay frozen at 0');
}

{
  // A wallet whose only tranche closed before the checkpoint instant must NOT count as active
  // (and its streak should reset), same as a V4 wallet with no open round.
  const ctx = context();
  v5Round(ctx, 1, '2026-05-03T00:00:00.000Z');
  ctx.walletRoundsRepo.upsert({
    wallet,
    roundId: 1,
    poolAddress: vault,
    tickets: 0,
    monPaid: '0',
    won: 0,
    withdrew: 0,
    prizeClaimed: '0',
    principalWithdrawn: '0',
    withdrawnAt: null,
    netPosition: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  ctx.walletRoundsRepo.upsertV5ResolvedBase(wallet, 1, vault, 5);
  ctx.v5TranchesRepo.insertTranche({
    wallet,
    vaultAddress: vault,
    poolType: 'vault',
    amount: '1000000000000000000',
    remainingAmount: '0',
    openedBlockNumber: 100,
    openedLogIndex: 0,
    openedAt: '2026-05-01T00:00:00.000Z',
    openedTxHash: '0xdef',
    startDrawId: 1,
    closedAt: '2026-05-04T00:00:00.000Z',
    closedBlockNumber: 200,
    closedLogIndex: 0,
    closedTxHash: '0xdef2',
  });

  ctx.pointsRepo.ensureWallet(wallet, 1);
  ctx.pointsRepo.upsertWalletStreak({
    wallet,
    currentStreakWeeks: 3,
    longestStreakWeeks: 3,
    lastCheckpointUnix: 0,
    consecutiveNonWins: 0,
    consecutiveMissedDraws: 0,
    updatedAt: 1,
  });

  const checkpointUnix = Date.parse('2026-05-10T00:00:00.000Z') / 1000;
  assert.equal(ctx.pointsRepo.hasActivePositionAt(wallet, checkpointUnix), false, 'fully withdrawn V5 wallet must not read as active');

  const result = ctx.service.runWeeklyCheckpoint(checkpointUnix);
  assert.equal(result.skipped, false);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 0, 'streak should reset once the V5 position is fully closed');
}

{
  // A full vault exit resets the vault streak even when a Patron position remains open and an
  // auto-compounded prize opens a fresh vault tranche before the next checkpoint.
  const ctx = context();
  v5Round(ctx, 1, '2026-05-03T00:00:00.000Z');
  ctx.walletRoundsRepo.upsert({
    wallet,
    roundId: 1,
    poolAddress: vault,
    tickets: 0,
    monPaid: '0',
    won: 0,
    withdrew: 0,
    prizeClaimed: '0',
    principalWithdrawn: '0',
    withdrawnAt: null,
    netPosition: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  ctx.walletRoundsRepo.upsertV5ResolvedBase(wallet, 1, vault, 5);

  ctx.v5TranchesRepo.insertTranche({
    wallet,
    vaultAddress: vault,
    poolType: 'vault',
    amount: '1000000000000000000',
    remainingAmount: '0',
    openedBlockNumber: 100,
    openedLogIndex: 0,
    openedAt: '2026-05-01T00:00:00.000Z',
    openedTxHash: '0xvault-old',
    startDrawId: 1,
    closedAt: '2026-05-08T00:00:00.000Z',
    closedBlockNumber: 200,
    closedLogIndex: 0,
    closedTxHash: '0xvault-exit',
  });
  ctx.v5TranchesRepo.insertTranche({
    wallet,
    vaultAddress: vault,
    poolType: 'degen',
    amount: '1000000000000000000',
    remainingAmount: '1000000000000000000',
    openedBlockNumber: 101,
    openedLogIndex: 0,
    openedAt: '2026-05-01T00:01:00.000Z',
    openedTxHash: '0xdegen',
    startDrawId: 1,
    closedAt: null,
    closedBlockNumber: null,
    closedLogIndex: null,
    closedTxHash: null,
  });
  ctx.v5TranchesRepo.insertTranche({
    wallet,
    vaultAddress: vault,
    poolType: 'vault',
    amount: '1000000000000000',
    remainingAmount: '1000000000000000',
    openedBlockNumber: 200,
    openedLogIndex: 1,
    openedAt: '2026-05-08T00:00:00.000Z',
    openedTxHash: '0xprize-compound',
    startDrawId: 2,
    closedAt: null,
    closedBlockNumber: null,
    closedLogIndex: null,
    closedTxHash: null,
  });

  const previousCheckpoint = Date.parse('2026-05-06T00:00:00.000Z') / 1000;
  ctx.pointsRepo.ensureWallet(wallet, previousCheckpoint);
  ctx.pointsRepo.upsertWalletStreak({
    wallet,
    currentStreakWeeks: 13,
    longestStreakWeeks: 13,
    lastCheckpointUnix: previousCheckpoint,
    consecutiveNonWins: 0,
    consecutiveMissedDraws: 0,
    updatedAt: previousCheckpoint,
  });

  const checkpointUnix = Date.parse('2026-05-10T00:00:00.000Z') / 1000;
  assert.equal(ctx.pointsRepo.hasActivePositionAt(wallet, checkpointUnix), true);
  assert.equal(ctx.pointsRepo.hadV5VaultFullExitBetween(wallet, previousCheckpoint, checkpointUnix), true);

  const result = ctx.service.runWeeklyCheckpoint(checkpointUnix);
  assert.equal(result.skipped, false);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 0, 'a full exit resets immediately; a fresh prize tranche rebuilds only after its next participated draw');
}


for (const [name, closedAt, survives] of [
  ['full exit before delayed settlement', '2026-05-02T00:00:00.000Z', false],
  ['full exit at settlement timestamp', '2026-05-03T00:00:00.000Z', false],
  ['full exit after settlement', '2026-05-04T00:00:00.000Z', false],
  ['partial exit before delayed settlement', '2026-05-02T00:00:00.000Z', true],
] as const) {
  const ctx = context();
  v5Round(ctx, 1, '2026-05-03T00:00:00.000Z');
  ctx.walletRoundsRepo.upsert({
    wallet, roundId: 1, poolAddress: vault, tickets: 0, monPaid: '0', won: 0,
    withdrew: 0, prizeClaimed: '0', principalWithdrawn: '0', withdrawnAt: null,
    netPosition: '0', createdAt: closedAt, updatedAt: closedAt,
  });
  ctx.walletRoundsRepo.upsertV5ResolvedBase(wallet, 1, vault, 12.5);
  ctx.v5TranchesRepo.insertTranche({
    wallet, vaultAddress: vault, poolType: 'vault', amount: '1000000000000000000',
    remainingAmount: '0', openedBlockNumber: 100, openedLogIndex: 1,
    openedAt: '2026-05-01T00:00:00.000Z', openedTxHash: '0xdeposit', startDrawId: 1,
    closedAt, closedBlockNumber: 200, closedLogIndex: 1, closedTxHash: '0xexit',
  });
  if (survives) {
    ctx.v5TranchesRepo.insertTranche({
      wallet, vaultAddress: vault, poolType: 'vault', amount: '1000000000000000000',
      remainingAmount: '1000000000000000000', openedBlockNumber: 99, openedLogIndex: 0,
      openedAt: '2026-04-30T00:00:00.000Z', openedTxHash: '0xolder', startDrawId: 1,
      closedAt: null, closedBlockNumber: null, closedLogIndex: null, closedTxHash: null,
    });
  }
  const checkpointUnix = Date.parse('2026-05-10T00:00:00.000Z') / 1000;
  ctx.service.runWeeklyCheckpoint(checkpointUnix);
  const profile = ctx.pointsRepo.getProfile(wallet)!;
  assert.equal(profile.currentStreakWeeks, survives ? 1 : 0, name);
  assert.equal(profile.consecutiveNonWins, survives ? 1 : 0, name);
  assert.ok(profile.lifetimePoints > 0, `${name}: historical earned points survive`);
  const earned = profile.lifetimePoints;
  ctx.service.runWeeklyCheckpoint(checkpointUnix);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, survives ? 1 : 0, `${name}: replay`);
  assert.equal(ctx.pointsRepo.getProfile(wallet)!.lifetimePoints, earned, `${name}: replay preserves points`);
  if (!survives) {
    v5Round(ctx, 2, '2026-05-05T00:00:00.000Z');
    v5Round(ctx, 3, '2026-05-06T00:00:00.000Z');
    ctx.service.runWeeklyCheckpoint(checkpointUnix);
    assert.equal(ctx.pointsRepo.getProfile(wallet)!.currentStreakWeeks, 0, `${name}: stays reset across absent draws`);
    assert.equal(ctx.pointsRepo.getProfile(wallet)!.consecutiveMissedDraws, 2, `${name}: absence counts toward genuine comeback`);
    assert.equal(ctx.pointsRepo.getProfile(wallet)!.lifetimePoints, earned, `${name}: no historical points lost`);
  }
  ctx.db.close();
}
console.log('derivePointsV5Checkpoint.test.ts ok');
