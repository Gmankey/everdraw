import type { PointsRepo } from '../repositories/pointsRepo.js';
import type { RoundsRepo } from '../repositories/roundsRepo.js';
import type { WalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import { nowUnix } from '../utils/time.js';
import { calculateRoundPoints, lossStreakThresholdBonus, STREAK_MILESTONE_POINTS } from './pointsMath.js';

export interface DerivePointsService {
  rebuildSettlementPoints(): void;
  runWeeklyCheckpoint(checkpointUnix?: number): { processed: number; skipped: boolean; reason?: string };
}

export function createDerivePointsService(input: {
  pointsRepo: PointsRepo;
  roundsRepo: RoundsRepo;
  walletRoundsRepo: WalletRoundsRepo;
  pointsStartUnix?: number;
}): DerivePointsService {
  const { pointsRepo, roundsRepo, walletRoundsRepo } = input;
  const pointsStartUnix = input.pointsStartUnix ?? parsePointsStartUnix();

  return {
    rebuildSettlementPoints() {
      const timestamp = nowUnix();
      pointsRepo.resetRoundPointsAndTotals();
      const rounds = roundsRepo.listAll()
        .filter((round) => ['settled', 'skipped'].includes(round.state))
        .filter((round) => {
          const settledUnix = toUnix(round.settledAt);
          return settledUnix != null && settledUnix >= pointsStartUnix;
        })
        .sort((a, b) => {
          const ta = toUnix(a.settledAt) ?? 0;
          const tb = toUnix(b.settledAt) ?? 0;
          if (ta !== tb) return ta - tb;
          if (a.roundId !== b.roundId) return a.roundId - b.roundId;
          return a.poolAddress.localeCompare(b.poolAddress);
        });

      for (const round of rounds) {
        const participants = walletRoundsRepo.listByRound(round.roundId, round.poolAddress)
          .filter((participant) => participant.tickets > 0);
        const awardedAtUnix = toUnix(round.settledAt) ?? timestamp;
        const skippedOrFailed = round.isSkipped === 1 || round.state === 'skipped';

        for (const participant of participants) {
          const wallet = participant.wallet.toLowerCase();
          pointsRepo.ensureWallet(wallet, timestamp);
          const points = pointsRepo.getWalletPoints(wallet)!;
          const streak = pointsRepo.getWalletStreak(wallet)!;
          const won = participant.won === 1 || (round.winner != null && round.winner.toLowerCase() === wallet);
          const firstDeposit = points.hasReceivedFirstDepositBonus === 0;
          const hadPriorDeposit = pointsRepo.hadFirstDepositBefore(wallet, round.roundId);
          const comebackKing = points.hasReceivedComebackKingBonus === 0 && won && hadPriorDeposit;
          const onTheDouble = points.hasReceivedOnTheDoubleBonus === 0 && !skippedOrFailed && pointsRepo.hasOtherActivePoolAt(wallet, round.poolAddress, awardedAtUnix);
          const nextConsecutiveNonWins = skippedOrFailed ? streak.consecutiveNonWins : (won ? 0 : streak.consecutiveNonWins + 1);
          const lossStreakBonus = !won && !skippedOrFailed
            ? lossStreakThresholdBonus(nextConsecutiveNonWins, points.highestLossStreakBonusAwarded)
            : null;

          const result = calculateRoundPoints({
            tickets: participant.tickets,
            streakWeeks: streak.currentStreakWeeks,
            won,
            onTheDouble,
            lossStreakBonusPoints: lossStreakBonus?.points ?? 0,
            firstDeposit,
            comebackKing,
            skippedOrFailed,
          });

          pointsRepo.insertRoundPoints({
            wallet,
            poolAddress: round.poolAddress,
            roundId: round.roundId,
            basePoints: result.basePoints,
            multiplierX100: result.multiplierX100,
            bonusesBreakdown: JSON.stringify(result.bonuses),
            totalPoints: result.totalPoints,
            awardedAtUnix,
          });

          pointsRepo.upsertWalletPoints({
            ...points,
            lifetimePoints: points.lifetimePoints + result.totalPoints,
            hasReceivedFirstDepositBonus: firstDeposit ? 1 : points.hasReceivedFirstDepositBonus,
            hasReceivedFirstWinBonus: comebackKing ? 1 : points.hasReceivedFirstWinBonus,
            hasReceivedOnTheDoubleBonus: onTheDouble ? 1 : points.hasReceivedOnTheDoubleBonus,
            hasReceivedComebackKingBonus: comebackKing ? 1 : points.hasReceivedComebackKingBonus,
            highestLossStreakBonusAwarded: lossStreakBonus?.threshold ?? points.highestLossStreakBonusAwarded,
            updatedAt: timestamp,
          });

          pointsRepo.upsertWalletStreak({
            ...streak,
            consecutiveNonWins: nextConsecutiveNonWins,
            updatedAt: timestamp,
          });
        }
      }
    },

    runWeeklyCheckpoint(checkpointUnix = nowUnix()) {
      const weekStart = checkpointUnix - 7 * 86400;
      if (!pointsRepo.hasAnySettledRoundBetween(weekStart, checkpointUnix)) {
        console.warn(`[points] weekly checkpoint skipped at ${checkpointUnix}: no settled rounds in prior week`);
        return { processed: 0, skipped: true, reason: 'no settled rounds in prior week' };
      }

      let processed = 0;
      for (const wallet of pointsRepo.listWalletsWithDeposits()) {
        pointsRepo.ensureWallet(wallet, checkpointUnix);
        const points = pointsRepo.getWalletPoints(wallet)!;
        const streak = pointsRepo.getWalletStreak(wallet)!;
        const hasActivePosition = pointsRepo.hasActivePositionAt(wallet, checkpointUnix);
        const nextCurrent = hasActivePosition ? streak.currentStreakWeeks + 1 : 0;
        const nextLongest = Math.max(streak.longestStreakWeeks, nextCurrent);
        let highestAwarded = points.highestStreakMilestoneAwarded;
        let lifetimePoints = points.lifetimePoints;

        for (const [milestone, bonus] of STREAK_MILESTONE_POINTS) {
          if (nextCurrent === milestone && highestAwarded < milestone) {
            lifetimePoints += bonus;
            highestAwarded = milestone;
          }
        }

        pointsRepo.upsertWalletStreak({
          ...streak,
          currentStreakWeeks: nextCurrent,
          longestStreakWeeks: nextLongest,
          lastCheckpointUnix: checkpointUnix,
          updatedAt: checkpointUnix,
        });
        pointsRepo.upsertWalletPoints({
          ...points,
          lifetimePoints,
          highestStreakMilestoneAwarded: highestAwarded,
          updatedAt: checkpointUnix,
        });
        processed += 1;
      }
      return { processed, skipped: false };
    },
  };
}

function toUnix(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function parsePointsStartUnix(): number {
  const raw = process.env.POINTS_START_UNIX;
  if (raw == null || raw.trim() === '') return 0;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid POINTS_START_UNIX=${raw}. Expected a non-negative Unix timestamp in seconds.`);
  }
  return parsed;
}
