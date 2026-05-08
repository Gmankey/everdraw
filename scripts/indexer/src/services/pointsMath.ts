export type PointsTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';

export const STREAK_MILESTONE_POINTS = new Map<number, number>([
  [4, 50],
  [13, 200],
  [26, 500],
  [52, 1000],
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
  return [4, 13, 26, 52].find((milestone) => milestone > streakWeeks) ?? null;
}

export type BonusBreakdown = Record<string, number>;

export function calculateRoundPoints(input: {
  tickets: number;
  streakWeeks: number;
  won: boolean;
  hasBothVaults: boolean;
  consecutiveNonWins: number;
  firstDeposit: boolean;
  firstWin: boolean;
  skippedOrFailed?: boolean;
}): { basePoints: number; multiplierX100: number; bonuses: BonusBreakdown; totalPoints: number } {
  const basePoints = Math.max(0, Math.floor(input.tickets || 0));
  const multiplierX100 = getMultiplierX100(input.streakWeeks);
  if (input.skippedOrFailed) {
    return { basePoints: 0, multiplierX100, bonuses: {}, totalPoints: 0 };
  }

  const multiplied = Math.round((basePoints * multiplierX100) / 100);
  const bonuses: BonusBreakdown = {};
  if (input.won) bonuses.win = 25;
  if (input.hasBothVaults) bonuses.both_vaults = Math.round(multiplied * 0.10);
  if (input.consecutiveNonWins >= 10 && !input.won) bonuses.loss_streak = Math.round(multiplied * 0.20);
  if (input.firstDeposit) bonuses.first_deposit = 25;
  if (input.firstWin && input.won) bonuses.first_win = 100;

  const totalPoints = multiplied + Object.values(bonuses).reduce((sum, value) => sum + value, 0);
  return { basePoints, multiplierX100, bonuses, totalPoints };
}
