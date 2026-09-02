import type { PointsRepo } from '../repositories/pointsRepo.js';
import type { RoundsRepo } from '../repositories/roundsRepo.js';
import type { WalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import type { V5ClaimProofsRepo } from '../repositories/v5ClaimProofsRepo.js';
import { nowUnix } from '../utils/time.js';
import { calculateRoundPoints, lossStreakThresholdBonus, STREAK_MILESTONE_POINTS } from './pointsMath.js';

export interface DerivePointsService {
  rebuildSettlementPoints(): void;
  runWeeklyCheckpoint(checkpointUnix?: number, fromUnix?: number): { processed: number; skipped: boolean; reason?: string };
}

export function createDerivePointsService(input: {
  pointsRepo: PointsRepo;
  roundsRepo: RoundsRepo;
  walletRoundsRepo: WalletRoundsRepo;
  v5ClaimProofsRepo?: V5ClaimProofsRepo;
  pointsStartUnix?: number;
  /**
   * ADR-0049 §3 — entries a V5 participant must earn in a draw to qualify for
   * one-time bonuses (first deposit, prize patron, comeback king, loss streak).
   * 0 disables the gate. Production supplies this from runner config; it is
   * derived from the draw period so it is cadence-independent.
   */
  minQualifyingEntries?: number;
  /**
   * ADR-0049 §3 — vault position (wei, as a decimal string) a wallet must hold at
   * a checkpoint to qualify for streak-milestone bonuses. '0' disables the gate.
   */
  minQualifyingWei?: string;
}): DerivePointsService {
  const { pointsRepo, roundsRepo, walletRoundsRepo, v5ClaimProofsRepo } = input;
  const pointsStartUnix = input.pointsStartUnix ?? parsePointsStartUnix();
  const minQualifyingEntries = Math.max(0, input.minQualifyingEntries ?? 0);
  const minQualifyingWei = BigInt(input.minQualifyingWei ?? '0');

  return {
    rebuildSettlementPoints() {
      const timestamp = nowUnix();
      pointsRepo.resetRoundPointsAndTotals();
      pointsRepo.resetCurrentStreaksAfterFullV5Exits();
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
        const participantWallets = new Set(participants.map((participant) => participant.wallet.toLowerCase()));
        const awardedAtUnix = toUnix(round.settledAt) ?? timestamp;

        for (const wallet of knownWallets) {
          if (participantWallets.has(wallet)) continue;
          pointsRepo.ensureWallet(wallet, timestamp);
          const streak = applyFullExitBoundary(wallet, awardedAtUnix);
          pointsRepo.upsertWalletStreak({
            ...streak,
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

          // V5 draws carry a per-tranche-blended base (§2b); the account streak multiplier is NOT re-applied.
          const isV5 = participant.v5ResolvedBase != null;
          const entries = isV5 ? participant.v5ResolvedBase! : participant.tickets;

          // ADR-0049 §3 — one-time bonuses need a qualifying position held through this
          // draw. `entries` is the draw's time-weighted balance, so it measures exactly
          // that. Legacy V4 rows (ticket-denominated) are never gated.
          const qualifiesForOneOffBonuses = !isV5 || minQualifyingEntries <= 0 || entries >= minQualifyingEntries;

          const firstDeposit = points.hasReceivedFirstDepositBonus === 0 && qualifiesForOneOffBonuses;
          const prizePatron = points.hasReceivedPrizePatronBonus === 0
            && qualifiesForOneOffBonuses
            && pointsRepo.hasDegenDepositAtOrBefore(wallet, awardedAtUnix);
          // ADR-0049 §2 — Comeback King is ONE-TIME. It was previously repeatable, which
          // made exit -> miss 2 draws -> rejoin an unbounded farming loop.
          const comebackKing = streak.consecutiveMissedDraws >= 2
            && points.hasReceivedComebackKingBonus === 0
            && qualifiesForOneOffBonuses;
          const nextConsecutiveNonWins = won ? 0 : streak.consecutiveNonWins + 1;
          const lossStreakBonus = !won && qualifiesForOneOffBonuses
            ? lossStreakThresholdBonus(nextConsecutiveNonWins, points.highestLossStreakBonusAwarded)
            : null;

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
            hasReceivedFirstWinBonus: won ? 1 : points.hasReceivedFirstWinBonus,
            hasReceivedComebackKingBonus: comebackKing ? 1 : points.hasReceivedComebackKingBonus,
            hasReceivedPrizePatronBonus: prizePatron ? 1 : points.hasReceivedPrizePatronBonus,
            highestLossStreakBonusAwarded: lossStreakBonus?.threshold ?? points.highestLossStreakBonusAwarded,
            updatedAt: timestamp,
          });

          pointsRepo.upsertWalletStreak({
            ...streak,
            consecutiveNonWins: nextConsecutiveNonWins,
            consecutiveMissedDraws: 0,
            updatedAt: timestamp,
          });
          knownWallets.add(wallet);
        }
      }
    },

    runWeeklyCheckpoint(checkpointUnix = nowUnix(), fromUnix = checkpointUnix - 7 * 86400) {
      if (!pointsRepo.hasAnyCompletedDrawBetween(fromUnix, checkpointUnix)) {
        console.warn(`[points] weekly checkpoint skipped at ${checkpointUnix}: no completed draws in checkpoint interval`);
        return { processed: 0, skipped: true, reason: 'no completed draws in checkpoint interval' };
      }

      let processed = 0;
      for (const wallet of pointsRepo.listWalletsWithDeposits()) {
        pointsRepo.ensureWallet(wallet, checkpointUnix);
        const points = pointsRepo.getWalletPoints(wallet)!;
        const streak = pointsRepo.getWalletStreak(wallet)!;
        if (streak.lastCheckpointUnix != null && streak.lastCheckpointUnix >= checkpointUnix) {
          continue;
        }
        const hasActivePosition = pointsRepo.hasActivePositionAt(wallet, checkpointUnix);
        const drawParticipation = pointsRepo.listCompletedDrawParticipationBetween(
          wallet,
          fromUnix,
          checkpointUnix,
        );
        let consecutiveParticipated = 0;
        for (let index = drawParticipation.length - 1; index >= 0 && drawParticipation[index]; index -= 1) {
          consecutiveParticipated += 1;
        }
        const participatedInWindow = consecutiveParticipated > 0;
        const hadFullExit = streak.lastCheckpointUnix != null && streak.lastCheckpointUnix > 0
          ? pointsRepo.hadV5VaultFullExitBetween(wallet, streak.lastCheckpointUnix, checkpointUnix)
          : false;
        const qualifiesForStreak = hasActivePosition && participatedInWindow;
        const nextCurrent = qualifiesForStreak
          ? hadFullExit
            ? Math.min(1, consecutiveParticipated)
            : consecutiveParticipated === drawParticipation.length
              ? streak.currentStreakWeeks + consecutiveParticipated
              : consecutiveParticipated
          : 0;
        const nextLongest = Math.max(streak.longestStreakWeeks, nextCurrent);
        let highestAwarded = points.highestStreakMilestoneAwarded;
        let lifetimePoints = points.lifetimePoints;

        // ADR-0049 §3 — streak milestones are one-time bonuses and carry the same
        // qualifying-position requirement. They are the largest single block of the
        // one-off stack (185,000 of 455,000), so leaving them ungated would leave the
        // dust-farming vector largely intact.
        const qualifiesForMilestones = minQualifyingWei <= 0n
          || pointsRepo.hasQualifyingPositionAt(wallet, checkpointUnix, minQualifyingWei.toString());

        if (qualifiesForMilestones) {
          for (const [milestone, bonus] of STREAK_MILESTONE_POINTS) {
            if (nextCurrent >= milestone && highestAwarded < milestone) {
              lifetimePoints += bonus;
              highestAwarded = milestone;
            }
          }
        }

        // Persist the one-time award marker before the checkpoint cursor. If the process dies
        // between these writes, retrying the same checkpoint cannot duplicate the bonus.
        pointsRepo.upsertWalletPoints({
          ...points,
          lifetimePoints,
          highestStreakMilestoneAwarded: highestAwarded,
          updatedAt: checkpointUnix,
        });
        pointsRepo.upsertWalletStreak({
          ...streak,
          currentStreakWeeks: nextCurrent,
          longestStreakWeeks: nextLongest,
          lastCheckpointUnix: checkpointUnix,
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
