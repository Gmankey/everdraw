// Per-draw checkpoint invariants.
//
// Replaces pointsCheckpointGate.test.ts, which guarded a timer-driven checkpoint that no longer
// exists. That file's original regression -- "the checkpoint was defined but never invoked, so
// every wallet's streak froze at 0 forever" -- is now guarded in two places: canonicalReorg
// asserts a sync cycle actually drives the checkpoint, and this file asserts the semantics.
//
// The property that matters: streak state is a pure function of DRAW PARTICIPATION and is
// completely independent of wall-clock spacing between draws. The same sequence of draws must
// produce the same streak whether those draws are an hour apart or a week apart. That is what
// removes the class of bug where a configured interval and the on-chain draw period could
// disagree.
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createRoundsRepo } from '../repositories/roundsRepo.js';
import { createWalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import { createPointsRepo } from '../repositories/pointsRepo.js';
import { createV5ClaimProofsRepo } from '../repositories/v5ClaimProofsRepo.js';
import { createDerivePointsService } from './derivePoints.js';

const wallet = '0x00000000000000000000000000000000000000aa';
const other = '0x00000000000000000000000000000000000000bb';
const pool = '0x00000000000000000000000000000000000000a1';

function context() {
  const db = new Database(':memory:');
  applySchema(db);
  const roundsRepo = createRoundsRepo(db);
  const walletRoundsRepo = createWalletRoundsRepo(db);
  const pointsRepo = createPointsRepo(db);
  const v5ClaimProofsRepo = createV5ClaimProofsRepo(db);
  const service = createDerivePointsService({ pointsRepo, roundsRepo, walletRoundsRepo, v5ClaimProofsRepo });
  return { db, roundsRepo, walletRoundsRepo, pointsRepo, service };
}

/** Add a settled draw at an explicit instant, so tests control wall-clock spacing precisely. */
function draw(ctx: ReturnType<typeof context>, roundId: number, settledAtUnix: number) {
  const iso = new Date(settledAtUnix * 1000).toISOString();
  ctx.roundsRepo.upsert({
    roundId,
    poolAddress: pool,
    state: 'settled',
    isSkipped: 0,
    openedAt: iso,
    salesEndTime: iso,
    committedAt: null,
    drawnAt: null,
    unstakingAt: null,
    settledAt: iso,
    depositTotalMon: '0',
    monReceived: '0',
    yieldMon: '0',
    lossRatio: '0',
    ticketCount: 0,
    uniqueWalletCount: 0,
    winnerWalletsCount: 0,
    winner: null,
    winningTicket: null,
    updatedAt: iso,
  });
}

function participate(ctx: ReturnType<typeof context>, roundId: number, w = wallet) {
  ctx.walletRoundsRepo.upsert({
    wallet: w,
    roundId,
    poolAddress: pool,
    tickets: 1,
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
}

const streakOf = (ctx: ReturnType<typeof context>, w = wallet) =>
  ctx.pointsRepo.getProfile(w)!.currentStreakWeeks;

const BASE = Date.parse('2026-05-01T00:00:00.000Z') / 1000;

// --- one draw advances the streak by exactly one -------------------------------------
{
  const ctx = context();
  draw(ctx, 1, BASE);
  participate(ctx, 1);
  const result = ctx.service.runDrawCheckpoints();
  assert.equal(result.processedDraws, 1);
  assert.equal(streakOf(ctx), 1, 'one draw is one streak step -- never more');
}

// --- CADENCE INDEPENDENCE: identical draws, wildly different spacing, identical result --
// This is the core guarantee. Under the old timer-driven checkpoint the result depended on how
// many draws happened to fall inside a configured window, so an interval that disagreed with the
// on-chain draw period changed the answer. Nothing here reads a clock.
{
  const hourly = context();
  const weekly = context();
  for (let i = 1; i <= 10; i += 1) {
    draw(hourly, i, BASE + i * 3_600); // one hour apart
    participate(hourly, i);
    draw(weekly, i, BASE + i * 604_800); // one week apart
    participate(weekly, i);
  }
  hourly.service.runDrawCheckpoints();
  weekly.service.runDrawCheckpoints();

  assert.equal(streakOf(hourly), 10);
  assert.equal(streakOf(weekly), 10);
  assert.equal(
    streakOf(hourly),
    streakOf(weekly),
    'draw spacing must not change streak state -- this is what removes the interval/period mismatch',
  );
}

// --- idempotent: re-running applies nothing ------------------------------------------
{
  const ctx = context();
  for (let i = 1; i <= 5; i += 1) { draw(ctx, i, BASE + i * 3_600); participate(ctx, i); }
  ctx.service.runDrawCheckpoints();
  assert.equal(streakOf(ctx), 5);

  const second = ctx.service.runDrawCheckpoints();
  assert.equal(second.processedDraws, 0, 'already-applied draws must not be re-processed');
  assert.equal(streakOf(ctx), 5, 're-running must not double-advance the streak');

  const third = ctx.service.runDrawCheckpoints();
  assert.equal(streakOf(ctx), 5, 'and it must stay stable across repeated runs');
  assert.equal(third.processedDraws, 0);
}

// --- incremental: a new draw advances by exactly one more ------------------------------
{
  const ctx = context();
  for (let i = 1; i <= 3; i += 1) { draw(ctx, i, BASE + i * 3_600); participate(ctx, i); }
  ctx.service.runDrawCheckpoints();
  assert.equal(streakOf(ctx), 3);

  draw(ctx, 4, BASE + 4 * 3_600);
  participate(ctx, 4);
  const result = ctx.service.runDrawCheckpoints();
  assert.equal(result.processedDraws, 1, 'only the new draw is processed');
  assert.equal(streakOf(ctx), 4);
}

// --- missing a draw zeroes the streak ---------------------------------------------------
{
  const ctx = context();
  for (let i = 1; i <= 3; i += 1) { draw(ctx, i, BASE + i * 3_600); participate(ctx, i); }
  ctx.service.runDrawCheckpoints();
  assert.equal(streakOf(ctx), 3);

  draw(ctx, 4, BASE + 4 * 3_600); // wallet does NOT participate
  ctx.service.runDrawCheckpoints();
  assert.equal(streakOf(ctx), 0, 'missing a draw resets the streak');

  draw(ctx, 5, BASE + 5 * 3_600);
  participate(ctx, 5);
  ctx.service.runDrawCheckpoints();
  assert.equal(streakOf(ctx), 1, 'and it rebuilds from one, not from where it left off');
}

// --- NO DRAWS MEANS NO POINTS MOVEMENT --------------------------------------------------
// Time passing on its own must never advance anything.
{
  const ctx = context();
  draw(ctx, 1, BASE);
  participate(ctx, 1);
  ctx.service.runDrawCheckpoints();
  assert.equal(streakOf(ctx), 1);

  // No new draws, however much wall-clock time is imagined to pass.
  for (let i = 0; i < 5; i += 1) {
    const result = ctx.service.runDrawCheckpoints();
    assert.equal(result.processedDraws, 0);
  }
  assert.equal(streakOf(ctx), 1, 'no draw means no streak movement, ever');
}

// --- longest streak is preserved across a reset ------------------------------------------
{
  const ctx = context();
  for (let i = 1; i <= 4; i += 1) { draw(ctx, i, BASE + i * 3_600); participate(ctx, i); }
  ctx.service.runDrawCheckpoints();
  draw(ctx, 5, BASE + 5 * 3_600); // missed
  ctx.service.runDrawCheckpoints();
  const profile = ctx.pointsRepo.getProfile(wallet)!;
  assert.equal(profile.currentStreakWeeks, 0);
  assert.equal(profile.longestStreakWeeks, 4, 'a reset must not erase the historical maximum');
}

// --- wallets advance independently --------------------------------------------------------
{
  const ctx = context();
  for (let i = 1; i <= 3; i += 1) {
    draw(ctx, i, BASE + i * 3_600);
    participate(ctx, i);
    if (i === 1) participate(ctx, i, other); // `other` only shows up for draw 1
  }
  ctx.service.runDrawCheckpoints();
  assert.equal(streakOf(ctx, wallet), 3);
  assert.equal(streakOf(ctx, other), 0, 'a wallet that stopped participating is zeroed, not frozen');
}

console.log('derivePointsPerDrawCheckpoint.test.ts ok');
