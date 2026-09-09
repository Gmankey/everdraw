import type { PointsRepo } from '../repositories/pointsRepo.js';
import type { RoundsRepo } from '../repositories/roundsRepo.js';
import type { WalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import type { V5ClaimProofsRepo } from '../repositories/v5ClaimProofsRepo.js';
import { nowUnix } from '../utils/time.js';
import { calculateRoundPoints, lossStreakThresholdBonus, pointsFormulaFingerprint, POINTS_FORMULA_VERSION, qualifiesForOneOffBonuses, STREAK_MILESTONE_POINTS } from './pointsMath.js';

export interface DerivePointsService {
  rebuildSettlementPoints(): void;
  /** Identifies the formula and configuration this service would apply right now. */
  inputFingerprint(): string;
  runWeeklyCheckpoint(checkpointUnix?: number, fromUnix?: number): { processed: number; skipped: boolean; reason?: string };
}

export function createDerivePointsService(input: {
  pointsRepo: PointsRepo;
  roundsRepo: RoundsRepo;
  walletRoundsRepo: WalletRoundsRepo;
  v5ClaimProofsRepo?: V5ClaimProofsRepo;
  pointsStartUnix?: number;
  /** Minimum principal held continuously for an entire V5 draw, in wei. */
  minQualifyingWei?: string;
}): DerivePointsService {
  const { pointsRepo, roundsRepo, walletRoundsRepo, v5ClaimProofsRepo } = input;
  const pointsStartUnix = input.pointsStartUnix ?? parsePointsStartUnix();
  const minQualifyingWei = BigInt(input.minQualifyingWei ?? '0');

  const rebuildSettlementPoints = () => {
    const timestamp = nowUnix();

    pointsRepo.assertFormulaCompatible(
      POINTS_FORMULA_VERSION,
      pointsFormulaFingerprint(minQualifyingWei.toString()),
      timestamp,
    );

    pointsRepo.withTransaction(() => {
      // Every value below is derived from canonical rounds, wallet-rounds and position events.
      // Clearing all markers makes rewinds deterministic: removed draws cannot retain awards.
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

      const knownWallets = new Set<string>();
      const lastProcessedDrawUnix = new Map<string, number>();

      const applyFullExitBoundary = (wallet: string, awardedAtUnix: number) => {
        const streak = pointsRepo.getWalletStreak(wallet)!;
        const fromUnix = lastProcessedDrawUnix.get(wallet) ?? pointsStartUnix;
        lastProcessedDrawUnix.set(wallet, awardedAtUnix);
        if (!pointsRepo.hadV5VaultFullExitBetween(wallet, fromUnix, awardedAtUnix)) {
          return streak;
        }
        return {
          ...streak,
          currentStreakWeeks: 0,
          consecutiveNonWins: 0,
          consecutiveMissedDraws: 0,
        };
      };

      for (const round of rounds) {
        const proofWinners = new Set(
          v5ClaimProofsRepo?.listWinnerAccounts(round.poolAddress, round.roundId) ?? []
        );
        const participants = walletRoundsRepo.listByRound(round.roundId, round.poolAddress)
          .filter((participant) => participant.tickets > 0 || (participant.v5ResolvedBase ?? 0) > 0);
        const participantWallets = new Set(
          participants.map((participant) => participant.wallet.toLowerCase())
        );
        const awardedAtUnix = toUnix(round.settledAt) ?? timestamp;

        for (const wallet of knownWallets) {
          if (participantWallets.has(wallet)) continue;
          pointsRepo.ensureWallet(wallet, timestamp);
          const streak = applyFullExitBoundary(wallet, awardedAtUnix);
          pointsRepo.upsertWalletStreak({
            ...streak,
            currentStreakWeeks: 0,
            lastCheckpointUnix: awardedAtUnix,
            consecutiveMissedDraws: streak.consecutiveMissedDraws + 1,
            updatedAt: timestamp,
          });
        }

        for (const participant of participants) {
          const wallet = participant.wallet.toLowerCase();
          pointsRepo.ensureWallet(wallet, timestamp);
          const points = pointsRepo.getWalletPoints(wallet)!;
          const streak = applyFullExitBoundary(wallet, awardedAtUnix);
          const won = participant.won === 1
            || (round.winner != null && round.winner.toLowerCase() === wallet)
            || proofWinners.has(wallet);

          // V5 base already includes each tranche's own multiplier. Eligibility is deliberately
          // separate: the minimum unboosted principal held for the complete draw.
          const isV5 = participant.v5ResolvedBase != null;
          const entries = isV5 ? participant.v5ResolvedBase! : participant.tickets;
          const historicalMinimum = BigInt(participant.v5MinPrincipalWei ?? '0');
          const qualifiesForBonuses = qualifiesForOneOffBonuses({
            isV5,
            minimumQualifyingWei: minQualifyingWei,
            historicalMinimumWei: historicalMinimum,
          });

          const firstDeposit = points.hasReceivedFirstDepositBonus === 0
            && qualifiesForBonuses;
          const prizePatron = points.hasReceivedPrizePatronBonus === 0
            && qualifiesForBonuses
            && pointsRepo.hasDegenDepositAtOrBefore(wallet, awardedAtUnix);
          const comebackKing = streak.consecutiveMissedDraws >= 2
            && points.hasReceivedComebackKingBonus === 0
            && qualifiesForBonuses;
          const nextConsecutiveNonWins = won ? 0 : streak.consecutiveNonWins + 1;
          const lossStreakBonus = !won && qualifiesForBonuses
            ? lossStreakThresholdBonus(nextConsecutiveNonWins, points.highestLossStreakBonusAwarded)
            : null;

          const nextCurrentStreak = streak.currentStreakWeeks + 1;
          const nextLongestStreak = Math.max(streak.longestStreakWeeks, nextCurrentStreak);
          let highestMilestone = points.highestStreakMilestoneAwarded;
          let milestonePoints = 0;
          if (qualifiesForBonuses) {
            for (const [milestone, bonus] of STREAK_MILESTONE_POINTS) {
              if (nextCurrentStreak >= milestone && highestMilestone < milestone) {
                milestonePoints += bonus;
                highestMilestone = milestone;
              }
            }
          }

          const result = calculateRoundPoints({
            entries,
            multiplierX100Override: isV5 ? 100 : undefined,
            streakWeeks: streak.currentStreakWeeks,
            won,
            lossStreakBonusPoints: lossStreakBonus?.points ?? 0,
            firstDeposit,
            comebackKing,
            prizePatron,
          });
          if (milestonePoints > 0) {
            result.bonuses.streak_milestone = milestonePoints;
            result.totalPoints += milestonePoints;
          }

          pointsRepo.insertRoundPoints({
            wallet,
            poolAddress: round.poolAddress,
            roundId: round.roundId,
            basePoints: result.basePoints,
            multiplierX100: result.multiplierX100,
            bonusesBreakdown: JSON.stringify(result.bonuses),
            totalPoints: result.totalPoints,
            awardedAtUnix,
            formulaVersion: POINTS_FORMULA_VERSION,
          });

          pointsRepo.upsertWalletPoints({
            ...points,
            lifetimePoints: points.lifetimePoints + result.totalPoints,
            hasReceivedFirstDepositBonus: firstDeposit ? 1 : points.hasReceivedFirstDepositBonus,
            hasReceivedFirstWinBonus: won ? 1 : points.hasReceivedFirstWinBonus,
            hasReceivedComebackKingBonus: comebackKing ? 1 : points.hasReceivedComebackKingBonus,
            hasReceivedPrizePatronBonus: prizePatron ? 1 : points.hasReceivedPrizePatronBonus,
            highestLossStreakBonusAwarded: lossStreakBonus?.threshold
              ?? points.highestLossStreakBonusAwarded,
            highestStreakMilestoneAwarded: highestMilestone,
            updatedAt: timestamp,
          });

          pointsRepo.upsertWalletStreak({
            ...streak,
            currentStreakWeeks: nextCurrentStreak,
            longestStreakWeeks: nextLongestStreak,
            lastCheckpointUnix: awardedAtUnix,
            consecutiveNonWins: nextConsecutiveNonWins,
            consecutiveMissedDraws: 0,
            updatedAt: timestamp,
          });
          knownWallets.add(wallet);
        }
      }

      // A full exit after the latest completed draw resets immediately. Re-entry only starts a
      // new streak after the next draw in which the wallet participates.
      pointsRepo.resetCurrentStreaksAfterFullV5Exits();
    });
  };

  return {
    rebuildSettlementPoints,

    inputFingerprint() {
      return [
        POINTS_FORMULA_VERSION,
        pointsFormulaFingerprint(minQualifyingWei.toString()),
        `start=${pointsStartUnix}`,
      ].join(':');
    },

    // Compatibility entry point for the runner while checkpoint scheduling is removed.
    runWeeklyCheckpoint() {
      rebuildSettlementPoints();
      return { processed: pointsRepo.listWalletsWithDeposits().length, skipped: false };
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
