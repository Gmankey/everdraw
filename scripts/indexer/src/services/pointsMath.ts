export type PointsTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';

export const STREAK_MILESTONE_POINTS = new Map<number, number>([
  [2, 10_000],
  [4, 50_000],
  [13, 200_000],
  [26, 500_000],
  [52, 1_000_000],
]);

export const FIRST_DEPOSIT_POINTS = 25_000;
export const WIN_POINTS = 25_000;
export const COMEBACK_KING_POINTS = 100_000;
export const PRIZE_PATRON_POINTS = 25_000;

export const LOSS_STREAK_THRESHOLD_POINTS = new Map<number, number>([
  [10, 50_000],
  [26, 500_000],
  [52, 2_000_000],
]);

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

export function lossStreakThresholdBonus(nextConsecutiveNonWins: number, highestAwarded: number): { threshold: number; points: number } | null {
  let award: { threshold: number; points: number } | null = null;
  for (const [threshold, points] of LOSS_STREAK_THRESHOLD_POINTS) {
    if (nextConsecutiveNonWins >= threshold && highestAwarded < threshold) {
      award = { threshold, points };
    }
  }
  return award;
}

export function calculateRoundPoints(input: {
  entries: number;
  streakWeeks: number;
  won: boolean;
  lossStreakBonusPoints?: number;
  firstDeposit: boolean;
  comebackKing: boolean;
  prizePatron?: boolean;
  skippedOrFailed?: boolean;
}): { basePoints: number; multiplierX100: number; bonuses: BonusBreakdown; totalPoints: number } {
  const basePoints = Math.max(0, input.entries || 0);
  const multiplierX100 = getMultiplierX100(input.streakWeeks);

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
