export type PointsTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';

// Historical rows carry this version so future formula changes must add a new
// implementation instead of silently rewriting prior mainnet awards.
export const POINTS_FORMULA_VERSION = 'adr-0049-v1';

// ADR-0049 §2 — rebalanced bonus values (operator, 2026-09-02).
// The previous ×1000 values made the one-off stack worth ~4.36M, i.e. ~99% of a
// 1,000 MON year (4,392,360 base). These bring the full stack to 455,000 — ~10%
// of that year, roughly one month of a serious holder.
export const STREAK_MILESTONE_POINTS = new Map<number, number>([
  [2, 5_000],
  [4, 10_000],
  [13, 20_000],
  [26, 50_000],
  [52, 100_000],
]);

export const FIRST_DEPOSIT_POINTS = 2_500;
export const WIN_POINTS = 2_500;
export const COMEBACK_KING_POINTS = 10_000;
export const PRIZE_PATRON_POINTS = 2_500;

export const LOSS_STREAK_THRESHOLD_POINTS = new Map<number, number>([
  [10, 5_000],
  [26, 50_000],
  [52, 200_000],
]);

// ADR-0049 section 3: one-time bonuses require this minimum unboosted
// principal continuously throughout the awarding draw. Recurring Win is exempt.
export const MIN_QUALIFYING_MON = 100;

// Persisted with the first awarded row. Formula changes require an explicit versioned migration.
export const POINTS_FORMULA_FINGERPRINT = JSON.stringify({
  version: POINTS_FORMULA_VERSION,
  streakMilestones: [...STREAK_MILESTONE_POINTS],
  lossStreaks: [...LOSS_STREAK_THRESHOLD_POINTS],
  firstDeposit: FIRST_DEPOSIT_POINTS,
  win: WIN_POINTS,
  comebackKing: COMEBACK_KING_POINTS,
  prizePatron: PRIZE_PATRON_POINTS,
  minimumQualifyingMon: MIN_QUALIFYING_MON,
  vaultMultiplier: [[0, 100], [4, 110], [8, 125], [13, 150], [26, 200]],
  patronMultiplier: [[1, 200], [2, 300], [3, 400], [4, 500]],
  baseRounding: 'Math.round',
});


export function getMultiplierX100(streakWeeks: number): number {
  if (streakWeeks >= 26) return 200;
  if (streakWeeks >= 13) return 150;
  if (streakWeeks >= 8) return 125;
  if (streakWeeks >= 4) return 110;
  return 100;
}

export function getTier(streakWeeks: number): PointsTier {
  if (streakWeeks >= 26) return 'Diamond';
  if (streakWeeks >= 13) return 'Platinum';
  if (streakWeeks >= 8) return 'Gold';
  if (streakWeeks >= 4) return 'Silver';
  return 'Bronze';
}

export function nextTierThreshold(streakWeeks: number): number | null {
  if (streakWeeks < 4) return 4;
  if (streakWeeks < 8) return 8;
  if (streakWeeks < 13) return 13;
  if (streakWeeks < 26) return 26;
  return null;
}

export function nextMilestone(streakWeeks: number): number | null {
  return [2, 4, 13, 26, 52].find((milestone) => milestone > streakWeeks) ?? null;
}

export function getDegenMultiplierX100(degenWeeks: number): number {
  if (degenWeeks >= 4) return 500;
  if (degenWeeks >= 3) return 400;
  if (degenWeeks >= 2) return 300;
  return 200;
}

export function trancheTenureWeeks(firstFullWeightDrawId: number | null, drawId: number): number {
  if (firstFullWeightDrawId == null || drawId < firstFullWeightDrawId) return 0;
  return drawId - firstFullWeightDrawId + 1;
}

export function multiplierForTranche(input: {
  poolType: 'vault' | 'degen';
  firstFullWeightDrawId: number | null;
  drawId: number;
}): number {
  const weeks = trancheTenureWeeks(input.firstFullWeightDrawId, input.drawId);
  if (input.poolType === 'degen') return getDegenMultiplierX100(weeks);
  return getMultiplierX100(weeks);
}

export type BonusBreakdown = Record<string, number>;

/**
 * Awards EVERY newly-crossed loss-streak threshold, not just the highest.
 * Previously this kept only the last match, so a wallet advancing multiple
 * thresholds in one processing step (replay / catch-up — the defect-#8 class)
 * silently lost the lower awards. Matches the streak-milestone loop's behaviour.
 * `threshold` is the highest crossed, which is what the caller persists as the
 * new high-water mark; `points` is the sum of all newly crossed.
 */
export function lossStreakThresholdBonus(nextConsecutiveNonWins: number, highestAwarded: number): { threshold: number; points: number } | null {
  let points = 0;
  let threshold = 0;
  for (const [candidate, candidatePoints] of LOSS_STREAK_THRESHOLD_POINTS) {
    if (nextConsecutiveNonWins >= candidate && highestAwarded < candidate) {
      points += candidatePoints;
      threshold = candidate;
    }
  }
  return threshold === 0 ? null : { threshold, points };
}

export function calculateRoundPoints(input: {
  entries: number;
  streakWeeks: number;
  won: boolean;
  lossStreakBonusPoints?: number;
  firstDeposit: boolean;
  comebackKing: boolean;
  prizePatron?: boolean;
  // V5: base already has per-tranche multipliers baked in (§2b), so pass 100 to skip the account-streak multiplier.
  multiplierX100Override?: number;
}): { basePoints: number; multiplierX100: number; bonuses: BonusBreakdown; totalPoints: number } {
  const basePoints = Math.max(0, input.entries || 0);
  const multiplierX100 = input.multiplierX100Override ?? getMultiplierX100(input.streakWeeks);

  const multiplied = Math.round((basePoints * multiplierX100) / 100);
  const bonuses: BonusBreakdown = {};
  if (input.won) bonuses.win = WIN_POINTS;
  if ((input.lossStreakBonusPoints ?? 0) > 0 && !input.won) bonuses.loss_streak = input.lossStreakBonusPoints!;
  if (input.firstDeposit) bonuses.first_deposit = FIRST_DEPOSIT_POINTS;
  if (input.comebackKing) bonuses.comeback_king = COMEBACK_KING_POINTS;
  if (input.prizePatron) bonuses.prize_patron = PRIZE_PATRON_POINTS;

  const totalPoints = multiplied + Object.values(bonuses).reduce((sum, value) => sum + value, 0);
  return { basePoints, multiplierX100, bonuses, totalPoints };
}
