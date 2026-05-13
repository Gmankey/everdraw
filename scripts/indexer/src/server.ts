import express from 'express';
import cors from 'cors';
import type { Server } from 'node:http';
import type { IndexerRunner } from './runner/service.js';
import type { RoundsRepo } from './repositories/roundsRepo.js';
import type { WalletRoundsRepo } from './repositories/walletRoundsRepo.js';
import type { PointsRepo } from './repositories/pointsRepo.js';
import { calculateRoundPoints, getMultiplierX100, getTier, lossStreakThresholdBonus, nextMilestone, nextTierThreshold } from './services/pointsMath.js';

export interface ApiServer {
  start(): Promise<Server>;
}

export function createApiServer(params: {
  port: number;
  runner: IndexerRunner;
  roundsRepo: RoundsRepo;
  walletRoundsRepo: WalletRoundsRepo;
  pointsRepo: PointsRepo;
  startedAt: number;
}): ApiServer {
  const { port, runner, roundsRepo, walletRoundsRepo, pointsRepo, startedAt } = params;
  const app = express();
  app.use(cors());

  app.get('/api/health', async (_req, res) => {
    try {
      const status = await runner.getStatus();
      res.json({
        lastScannedBlock: status.lastScannedBlock,
        chainHead: status.chainHead,
        lag: status.lag,
        dbStatus: 'ok',
        uptime: Math.floor((Date.now() - startedAt) / 1000),
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'unknown error',
        dbStatus: 'error',
      });
    }
  });

  app.get('/api/rounds', (_req, res) => {
    const rounds = roundsRepo.listAll().map((row) => ({
      roundId: row.roundId,
      poolAddress: row.poolAddress,
      state: row.state,
      ticketCount: row.ticketCount,
      uniqueWallets: row.uniqueWalletCount,
      totalMonPaid: row.depositTotalMon,
      winner: row.winner,
      winningTicket: row.winningTicket,
      settledAt: row.settledAt,
      salesEndTime: row.salesEndTime,
      openedAt: row.openedAt,
      committedAt: row.committedAt,
      drawnAt: row.drawnAt,
      monReceived: row.monReceived,
      yieldMon: row.yieldMon,
      lossRatio: row.lossRatio,
      isSkipped: row.isSkipped,
    }));

    res.json(rounds.sort((a, b) => Number(b.roundId) - Number(a.roundId)));
  });

  app.get('/api/points/preview', (req, res) => {
    const wallet = String(req.query.wallet ?? '').toLowerCase();
    const tickets = Number(req.query.tickets ?? 0);
    if (!/^0x[0-9a-fA-F]{40}$/i.test(wallet) || !Number.isFinite(tickets) || tickets < 0) {
      res.status(400).json({ error: 'invalid wallet or tickets' });
      return;
    }
    const streak = pointsRepo.getWalletStreak(wallet);
    const points = pointsRepo.getWalletPoints(wallet);
    const result = calculateRoundPoints({
      tickets,
      streakWeeks: streak?.currentStreakWeeks ?? 0,
      won: false,
      onTheDouble: false,
      lossStreakBonusPoints: lossStreakThresholdBonus((streak?.consecutiveNonWins ?? 0) + 1, points?.highestLossStreakBonusAwarded ?? 0)?.points ?? 0,
      firstDeposit: !points || points.hasReceivedFirstDepositBonus === 0,
      comebackKing: false,
    });
    res.json({
      estimated_base_points: result.basePoints,
      estimated_multiplier_x100: result.multiplierX100,
      estimated_bonuses_preview: result.bonuses,
      estimated_total: result.totalPoints,
    });
  });

  app.get('/api/points/:wallet', async (req, res) => {
    const wallet = req.params.wallet.toLowerCase();
    if (!/^0x[0-9a-fA-F]{40}$/i.test(wallet)) {
      res.status(400).json({ error: 'invalid wallet address' });
      return;
    }
    const profile = pointsRepo.getProfile(wallet);
    const currentStreakWeeks = profile?.currentStreakWeeks ?? 0;
    const lifetimePoints = profile?.lifetimePoints ?? 0;
    res.json({
      wallet,
      ens: null,
      lifetime_points: lifetimePoints,
      current_streak_weeks: currentStreakWeeks,
      longest_streak_weeks: profile?.longestStreakWeeks ?? 0,
      current_multiplier_x100: getMultiplierX100(currentStreakWeeks),
      current_tier: getTier(currentStreakWeeks),
      consecutive_non_wins: profile?.consecutiveNonWins ?? 0,
      highest_streak_milestone_awarded: profile?.highestStreakMilestoneAwarded ?? 0,
      highest_loss_streak_bonus_awarded: profile?.highestLossStreakBonusAwarded ?? 0,
      has_received_first_deposit_bonus: profile?.hasReceivedFirstDepositBonus ?? 0,
      has_received_first_win_bonus: profile?.hasReceivedFirstWinBonus ?? 0,
      has_received_on_the_double_bonus: profile?.hasReceivedOnTheDoubleBonus ?? 0,
      has_received_comeback_king_bonus: profile?.hasReceivedComebackKingBonus ?? 0,
      next_tier_threshold: nextTierThreshold(currentStreakWeeks),
      next_milestone: nextMilestone(currentStreakWeeks),
      rank: profile ? pointsRepo.getRank(wallet, 'all') : null,
    });
  });

  app.get('/api/points/:wallet/history', (req, res) => {
    const wallet = req.params.wallet.toLowerCase();
    if (!/^0x[0-9a-fA-F]{40}$/i.test(wallet)) {
      res.status(400).json({ error: 'invalid wallet address' });
      return;
    }
    const limit = Number(req.query.limit ?? 12);
    res.json(pointsRepo.listHistory(wallet, Number.isFinite(limit) ? limit : 12).map((row) => ({
      pool_address: row.poolAddress,
      round_id: row.roundId,
      base_points: row.basePoints,
      multiplier_x100: row.multiplierX100,
      bonuses_breakdown: JSON.parse(row.bonusesBreakdown || '{}'),
      total_points: row.totalPoints,
      awarded_at_unix: row.awardedAtUnix,
    })));
  });

  app.get('/api/leaderboard', (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    const period = req.query.period === 'month' ? 'month' : 'all';
    res.json(pointsRepo.listLeaderboard(Number.isFinite(limit) ? limit : 100, period).map((row) => ({
      wallet: row.wallet,
      ens: null,
      lifetime_points: row.lifetimePoints,
      month_points: row.monthPoints,
      current_streak_weeks: row.currentStreakWeeks,
      current_tier: getTier(row.currentStreakWeeks),
    })));
  });

  app.get('/api/rounds/:roundId/participants', (req, res) => {
    const roundId = Number(req.params.roundId);
    if (!Number.isFinite(roundId)) {
      res.status(400).json({ error: 'invalid roundId' });
      return;
    }

    const pool = typeof req.query.pool === 'string' ? req.query.pool : undefined;
    const participants = walletRoundsRepo.listByRound(roundId, pool).map((row) => ({
      wallet: row.wallet,
      poolAddress: row.poolAddress,
      tickets: row.tickets,
      monPaid: row.monPaid,
      won: row.won,
      prizeClaimed: row.prizeClaimed,
      principalWithdrawn: row.principalWithdrawn,
    }));

    res.json(participants);
  });

  app.get('/api/wallets/:wallet/rounds', (req, res) => {
    const { wallet } = req.params;
    if (!/^0x[0-9a-fA-F]{40}$/i.test(wallet)) {
      res.status(400).json({ error: 'invalid wallet address' });
      return;
    }
    const rows = walletRoundsRepo.listByWalletWithRound(wallet);
    res.json(rows.map((row) => ({
      poolAddress: row.poolAddress,
      roundId: row.roundId,
      tickets: row.tickets,
      monPaid: row.monPaid,
      won: row.won,
      prizeClaimed: row.prizeClaimed,
      principalWithdrawn: row.principalWithdrawn,
      state: row.state ?? 'open',
      salesEndTime: row.salesEndTime ?? null,
      isSkipped: row.isSkipped ?? 0,
    })));
  });

  return {
    async start() {
      return await new Promise<Server>((resolve) => {
        const server = app.listen(port, () => resolve(server));
      });
    },
  };
}
