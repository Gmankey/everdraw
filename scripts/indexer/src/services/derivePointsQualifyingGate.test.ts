// ADR-0049 §3 — one-time bonuses require a qualifying position held THROUGH the awarding
// draw. This is the Sybil control: without it, a dust wallet earns the same flat bonuses as
// a whale, so splitting capital across N wallets multiplies the one-off stack by N.
//
// Reference numbers this file encodes:
//   weekly draw, 100 MON floor -> minQualifyingEntries = 0.005 * 100 * 10080 = 5,040 entries
//   full one-off stack = 455,000; a 1,000 MON year of base = 4,392,360
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createRoundsRepo } from '../repositories/roundsRepo.js';
import { createWalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import { createPointsRepo } from '../repositories/pointsRepo.js';
import { createV5ClaimProofsRepo } from '../repositories/v5ClaimProofsRepo.js';
import { createV5TranchesRepo } from '../repositories/v5TranchesRepo.js';
import { createDerivePointsService } from './derivePoints.js';
import { minQualifyingEntries } from './pointsMath.js';

const wallet = '0x00000000000000000000000000000000000000aa';
const pool = '0x00000000000000000000000000000000000000a1';

const WEEKLY_SEC = 604_800;
const GATE_ENTRIES = minQualifyingEntries(WEEKLY_SEC); // 5,040
assert.equal(GATE_ENTRIES, 5_040);

function context(minQualifyingEntriesValue = GATE_ENTRIES, minQualifyingWei = '0') {
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
    minQualifyingEntries: minQualifyingEntriesValue,
    minQualifyingWei,
  });
  return { db, roundsRepo, walletRoundsRepo, pointsRepo, v5ClaimProofsRepo, v5TranchesRepo, service };
}

function round(ctx: ReturnType<typeof context>, roundId: number, settledAt: string, winner: string | null = null) {
  ctx.roundsRepo.upsert({
    roundId,
    poolAddress: pool,
    state: 'settled',
    isSkipped: 0,
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

/** A V5 participant: base comes from v5ResolvedBase, not tickets. */
function v5Participant(ctx: ReturnType<typeof context>, roundId: number, entries: number, won: 0 | 1 = 0) {
  ctx.walletRoundsRepo.upsert({
    wallet,
    roundId,
    poolAddress: pool,
    tickets: 0,
    monPaid: '0',
    won,
    withdrew: 0,
    prizeClaimed: '0',
    principalWithdrawn: '0',
    withdrawnAt: null,
    netPosition: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  ctx.walletRoundsRepo.upsertV5ResolvedBase(wallet, roundId, pool, entries);
}

function bonuses(ctx: ReturnType<typeof context>, roundId: number): Record<string, number> {
  const row = ctx.pointsRepo.listHistory(wallet, 200).find((item) => item.roundId === roundId);
  assert.ok(row, `missing points row for round ${roundId}`);
  return JSON.parse(row.bonusesBreakdown) as Record<string, number>;
}

// --- a dust position earns NO one-time bonuses -------------------------------------
{
  const ctx = context();
  round(ctx, 1, '2026-05-01T00:00:00.000Z');
  v5Participant(ctx, 1, 100); // ~2 MON for a week: far below the 5,040 floor
  ctx.service.rebuildSettlementPoints();

  assert.equal(bonuses(ctx, 1).first_deposit, undefined, 'dust must not earn First Deposit');
  const row = ctx.pointsRepo.listHistory(wallet, 10).find((item) => item.roundId === 1)!;
  assert.equal(row.basePoints, 100, 'base points are still earned in full — only bonuses are gated');
  assert.equal(row.totalPoints, 100, 'dust earns exactly its base, no bonus padding');
}

// --- a qualifying position earns them ----------------------------------------------
{
  const ctx = context();
  round(ctx, 1, '2026-05-01T00:00:00.000Z');
  v5Participant(ctx, 1, GATE_ENTRIES); // exactly 100 MON held for the whole draw
  ctx.service.rebuildSettlementPoints();

  assert.equal(bonuses(ctx, 1).first_deposit, 2_500, 'a qualifying position earns First Deposit');
}

// --- the boundary is inclusive, and one entry below it is not ------------------------
{
  const ctx = context();
  round(ctx, 1, '2026-05-01T00:00:00.000Z');
  v5Participant(ctx, 1, GATE_ENTRIES - 1);
  ctx.service.rebuildSettlementPoints();
  assert.equal(bonuses(ctx, 1).first_deposit, undefined, 'just below the floor does not qualify');
}

// --- Win is NOT gated: it is Sybil-neutral -------------------------------------------
// Expected wins scale with share of TWAB, so splitting confers no advantage. Gating it
// would punish small genuine players for no security benefit.
{
  const ctx = context();
  round(ctx, 1, '2026-05-01T00:00:00.000Z', wallet);
  v5Participant(ctx, 1, 100, 1); // dust, but won
  ctx.service.rebuildSettlementPoints();

  const b = bonuses(ctx, 1);
  assert.equal(b.win, 2_500, 'Win is recurring and Sybil-neutral, so it is never gated');
  assert.equal(b.first_deposit, undefined, 'the one-time bonus is still gated for the same wallet');
}

// --- legacy V4 rows (ticket-denominated) are never gated -----------------------------
// V4 base is tickets, not entries; applying an entries floor to it would silently strip
// bonuses from historical rows during a rebuild.
{
  const ctx = context();
  round(ctx, 1, '2026-05-01T00:00:00.000Z');
  ctx.walletRoundsRepo.upsert({
    wallet,
    roundId: 1,
    poolAddress: pool,
    tickets: 1, // V4 style: tickets, and NO v5ResolvedBase
    monPaid: '1',
    won: 0,
    withdrew: 0,
    prizeClaimed: '0',
    principalWithdrawn: '0',
    withdrawnAt: null,
    netPosition: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  ctx.service.rebuildSettlementPoints();

  assert.equal(bonuses(ctx, 1).first_deposit, 2_500, 'legacy V4 rows keep their bonuses');
}

// --- loss-streak thresholds are gated too --------------------------------------------
// Loss streak is the single largest farmable block (255,000) and needs no capital or skill:
// losing is the default state.
{
  const dust = context();
  for (let id = 1; id <= 10; id += 1) {
    round(dust, id, `2026-05-${String(id).padStart(2, '0')}T00:00:00.000Z`);
    v5Participant(dust, id, 100);
  }
  dust.service.rebuildSettlementPoints();
  assert.equal(bonuses(dust, 10).loss_streak, undefined, 'dust must not earn the 10-draw loss streak');

  const real = context();
  for (let id = 1; id <= 10; id += 1) {
    round(real, id, `2026-05-${String(id).padStart(2, '0')}T00:00:00.000Z`);
    v5Participant(real, id, GATE_ENTRIES);
  }
  real.service.rebuildSettlementPoints();
  assert.equal(bonuses(real, 10).loss_streak, 5_000, 'a qualifying position earns it');
}

// --- gate disabled (0) preserves previous behaviour ------------------------------------
{
  const ctx = context(0);
  round(ctx, 1, '2026-05-01T00:00:00.000Z');
  v5Participant(ctx, 1, 1);
  ctx.service.rebuildSettlementPoints();
  assert.equal(bonuses(ctx, 1).first_deposit, 2_500, 'a zero floor disables the gate entirely');
}

// --- streak milestones are gated on held position at the checkpoint ---------------------
// Milestones are 185,000 of the 455,000 stack, so leaving them ungated would leave most of
// the dust-farming vector intact.
{
  const minWei = (100n * 10n ** 18n).toString();
  const fromUnix = Date.parse('2026-05-01T00:00:00.000Z') / 1000;
  const checkpointUnix = Date.parse('2026-05-04T00:00:00.000Z') / 1000;

  function milestoneCtx(remainingAmount: string) {
    const ctx = context(GATE_ENTRIES, minWei);
    round(ctx, 1, '2026-05-02T00:00:00.000Z');
    v5Participant(ctx, 1, GATE_ENTRIES);
    round(ctx, 2, '2026-05-03T00:00:00.000Z');
    v5Participant(ctx, 2, GATE_ENTRIES);
    ctx.pointsRepo.ensureWallet(wallet, fromUnix);
    const prior = ctx.pointsRepo.getWalletPoints(wallet)!;
    ctx.pointsRepo.upsertWalletPoints({ ...prior, highestStreakMilestoneAwarded: 2, updatedAt: fromUnix });
    ctx.pointsRepo.upsertWalletStreak({
      wallet,
      currentStreakWeeks: 3,
      longestStreakWeeks: 3,
      lastCheckpointUnix: fromUnix,
      consecutiveNonWins: 0,
      consecutiveMissedDraws: 0,
      updatedAt: fromUnix,
    });
    ctx.v5TranchesRepo.insertTranche({
      wallet,
      vaultAddress: pool,
      poolType: 'vault',
      amount: remainingAmount,
      remainingAmount,
      openedBlockNumber: 90,
      openedLogIndex: 1,
      openedAt: '2026-04-01T00:00:00.000Z',
      openedTxHash: '0x0000000000000000000000000000000000000000000000000000000000000f04',
      startDrawId: 1,
      closedAt: null,
      closedBlockNumber: null,
      closedLogIndex: null,
      closedTxHash: null,
    });
    ctx.service.runWeeklyCheckpoint(checkpointUnix, fromUnix);
    return ctx.pointsRepo.getProfile(wallet)!;
  }

  // 1 MON held: streak still advances (participation is real) but no milestone payout.
  const dustProfile = milestoneCtx((1n * 10n ** 18n).toString());
  assert.equal(dustProfile.currentStreakWeeks, 5, 'the streak itself is not gated — only the bonus is');
  assert.equal(dustProfile.highestStreakMilestoneAwarded, 2, 'dust must not unlock the week-4 milestone');
  assert.equal(dustProfile.lifetimePoints, 0, 'no milestone points for a dust position');

  // 100 MON held: milestone awarded.
  const realProfile = milestoneCtx((100n * 10n ** 18n).toString());
  assert.equal(realProfile.highestStreakMilestoneAwarded, 4, 'a qualifying position unlocks it');
  assert.equal(realProfile.lifetimePoints, 10_000, 'week-4 milestone is 10,000 under ADR-0049');
}

// --- the BigInt sum must not overflow SQLite's 64-bit INTEGER ---------------------------
// 1 MON = 1e18 wei and int64 maxes near 9.22e18, so summing wei in SQL breaks above ~9 MON.
// This asserts a large position is measured correctly rather than silently wrapping.
{
  const ctx = context();
  const atUnix = Date.parse('2026-05-04T00:00:00.000Z') / 1000;
  for (let i = 0; i < 3; i += 1) {
    ctx.v5TranchesRepo.insertTranche({
      wallet,
      vaultAddress: pool,
      poolType: 'vault',
      amount: (5_000n * 10n ** 18n).toString(),
      remainingAmount: (5_000n * 10n ** 18n).toString(), // 5,000 MON per tranche
      openedBlockNumber: 90 + i,
      openedLogIndex: i,
      openedAt: '2026-04-01T00:00:00.000Z',
      openedTxHash: `0x${String(i).padStart(64, '0')}`,
      startDrawId: 1,
      closedAt: null,
      closedBlockNumber: null,
      closedLogIndex: null,
      closedTxHash: null,
    });
  }
  // 15,000 MON total — far past int64 wei range.
  assert.equal(
    ctx.pointsRepo.hasQualifyingPositionAt(wallet, atUnix, (15_000n * 10n ** 18n).toString()),
    true,
    '15,000 MON across three tranches must be summed exactly, not overflowed',
  );
  assert.equal(
    ctx.pointsRepo.hasQualifyingPositionAt(wallet, atUnix, (15_001n * 10n ** 18n).toString()),
    false,
    'and must not over-report',
  );
}

// --- a closed tranche does not count toward the qualifying position ----------------------
{
  const ctx = context();
  const atUnix = Date.parse('2026-05-04T00:00:00.000Z') / 1000;
  ctx.v5TranchesRepo.insertTranche({
    wallet,
    vaultAddress: pool,
    poolType: 'vault',
    amount: (100n * 10n ** 18n).toString(),
    remainingAmount: (100n * 10n ** 18n).toString(),
    openedBlockNumber: 90,
    openedLogIndex: 1,
    openedAt: '2026-04-01T00:00:00.000Z',
    openedTxHash: '0x0000000000000000000000000000000000000000000000000000000000000abc',
    startDrawId: 1,
    closedAt: '2026-05-02T00:00:00.000Z', // exited before the checkpoint
    closedBlockNumber: 100,
    closedLogIndex: 1,
    closedTxHash: '0x0000000000000000000000000000000000000000000000000000000000000abd',
  });
  assert.equal(
    ctx.pointsRepo.hasQualifyingPositionAt(wallet, atUnix, (100n * 10n ** 18n).toString()),
    false,
    'a position closed before the checkpoint must not qualify',
  );
}

console.log('derivePointsQualifyingGate.test.ts ok');
