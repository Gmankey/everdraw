import express from 'express';
import cors from 'cors';
import type { Server } from 'node:http';
import type { IndexerRunner } from './runner/service.js';
import type { RoundsRepo } from './repositories/roundsRepo.js';
import type { WalletRoundsRepo } from './repositories/walletRoundsRepo.js';
import type { PointsRepo } from './repositories/pointsRepo.js';
import type { V5TranchesRepo } from './repositories/v5TranchesRepo.js';
import type { V5ClaimProofsRepo } from "./repositories/v5ClaimProofsRepo.js";
import type { V5DeploymentScope } from "./types/domain.js";
import {
  assertPublishedProofsMatchDistribution,
  secureSecretEqual,
  validatePublishedClaimProofs,
  type ClaimProofDistributionSnapshot,
} from "./services/v5ClaimProofs.js";
import { calculateRoundPoints, getMultiplierX100, getTier, lossStreakThresholdBonus, nextMilestone, nextTierThreshold } from './services/pointsMath.js';
import { firstFullWeightDrawId } from './services/deriveV5Tranches.js';
import { normalizeVaultQuery, scopeRowsByVault } from './vaultFilter.js';

export interface ApiServer {
  start(): Promise<Server>;
}

export function createApiServer(params: {
  port: number;
  runner: IndexerRunner;
  roundsRepo: RoundsRepo;
  walletRoundsRepo: WalletRoundsRepo;
  pointsRepo: PointsRepo;
  v5TranchesRepo?: V5TranchesRepo;
  v5ClaimProofsRepo?: V5ClaimProofsRepo;
  v5Deployments?: V5DeploymentScope[];
  claimProofIngestSecret?: string;
  claimProofDistributionReader?: (
    claimManagerAddress: string,
    distributionId: string,
  ) => Promise<ClaimProofDistributionSnapshot>;
  startedAt: number;
}): ApiServer {
  const {
    port,
    runner,
    roundsRepo,
    walletRoundsRepo,
    pointsRepo,
    v5TranchesRepo,
    v5ClaimProofsRepo,
    v5Deployments = [],
    claimProofIngestSecret,
    claimProofDistributionReader,
    startedAt,
  } = params;
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get('/api/health', async (_req, res) => {
    try {
      const status = await runner.getStatus();
      res.json({
        lastScannedBlock: status.lastScannedBlock,
        chainHead: status.chainHead,
        confirmedHead: status.confirmedHead,
        canonicalHash: status.canonicalHash,
        rewindCount: status.rewindCount,
        v5Deployments: status.v5Deployments,
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
      entries: tickets,
      streakWeeks: streak?.currentStreakWeeks ?? 0,
      won: false,
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
      consecutive_missed_draws: profile?.consecutiveMissedDraws ?? 0,
      highest_streak_milestone_awarded: profile?.highestStreakMilestoneAwarded ?? 0,
      highest_loss_streak_bonus_awarded: profile?.highestLossStreakBonusAwarded ?? 0,
      has_received_first_deposit_bonus: profile?.hasReceivedFirstDepositBonus ?? 0,
      has_received_first_win_bonus: profile?.hasReceivedFirstWinBonus ?? 0,
      has_received_comeback_king_bonus: profile?.hasReceivedComebackKingBonus ?? 0,
      has_received_prize_patron_bonus: profile?.hasReceivedPrizePatronBonus ?? 0,
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

  app.get('/api/v5/wallets/:wallet/tranches', (req, res) => {
    if (!v5TranchesRepo) {
      res.status(501).json({ error: 'v5 tranche ledger is not configured' });
      return;
    }
    const wallet = req.params.wallet.toLowerCase();
    if (!/^0x[0-9a-fA-F]{40}$/i.test(wallet)) {
      res.status(400).json({ error: 'invalid wallet address' });
      return;
    }
    const vault = normalizeVaultQuery(req.query.vault);
    if (!vault.valid) {
      res.status(400).json({ error: 'invalid vault address' });
      return;
    }
    const tranches = scopeRowsByVault(v5TranchesRepo.listByWallet(wallet), vault.address);
    res.json(tranches.map((row) => ({
      wallet: row.wallet,
      vault_address: row.vaultAddress,
      pool_type: row.poolType,
      amount: row.amount,
      remaining_amount: row.remainingAmount,
      opened_block_number: row.openedBlockNumber,
      opened_log_index: row.openedLogIndex,
      opened_at: row.openedAt,
      opened_tx_hash: row.openedTxHash,
      start_draw_id: row.startDrawId,
      first_full_weight_draw_id: firstFullWeightDrawId(row.startDrawId),
      closed_at: row.closedAt,
      closed_block_number: row.closedBlockNumber,
      closed_log_index: row.closedLogIndex,
      closed_tx_hash: row.closedTxHash,
    })));
  });

  app.get('/api/v5/wallets/:wallet/position-events', (req, res) => {
    if (!v5TranchesRepo) {
      res.status(501).json({ error: 'v5 tranche ledger is not configured' });
      return;
    }
    const wallet = req.params.wallet.toLowerCase();
    if (!/^0x[0-9a-fA-F]{40}$/i.test(wallet)) {
      res.status(400).json({ error: 'invalid wallet address' });
      return;
    }
    const vault = normalizeVaultQuery(req.query.vault);
    if (!vault.valid) {
      res.status(400).json({ error: 'invalid vault address' });
      return;
    }
    const positionEvents = scopeRowsByVault(v5TranchesRepo.listPositionEvents(wallet), vault.address);
    res.json(positionEvents.map((row) => ({
      tx_hash: row.txHash,
      log_index: row.logIndex,
      block_number: row.blockNumber,
      block_timestamp: row.blockTimestamp,
      vault_address: row.vaultAddress,
      wallet: row.wallet,
      pool_type: row.poolType,
      action: row.action,
      amount: row.amount,
      balance_after: row.balanceAfter,
      raw_event_name: row.rawEventName,
      source: row.source,
    })));
  });

  app.post('/api/internal/v5/claim-proofs', async (req, res) => {
    if (!v5ClaimProofsRepo || !claimProofIngestSecret || !claimProofDistributionReader) {
      res.status(503).json({ error: 'claim-proof ingestion is not configured' });
      return;
    }
    const authorization = String(req.headers.authorization || '');
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!secureSecretEqual(claimProofIngestSecret, supplied)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const rows = validatePublishedClaimProofs(req.body, v5Deployments);
      const distribution = await claimProofDistributionReader(
        rows[0].claimManagerAddress,
        rows[0].distributionId,
      );
      assertPublishedProofsMatchDistribution(rows, distribution);
      v5ClaimProofsRepo.publishDraw(rows);
      res.json({ stored: rows.length, drawId: rows[0]?.drawId ?? null, root: rows[0]?.root ?? null });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'invalid claim proofs' });
    }
  });

  app.get(['/api/v5/wallets/:wallet/claim-proofs', '/api/v5/claims'], (req, res) => {
    if (!v5ClaimProofsRepo) {
      res.status(501).json({ error: 'claim-proof storage is not configured' });
      return;
    }
    const wallet = String(req.params.wallet || req.query.account || '').toLowerCase();
    if (!/^0x[0-9a-fA-F]{40}$/i.test(wallet)) {
      res.status(400).json({ error: 'invalid wallet address' });
      return;
    }
    const vault = normalizeVaultQuery(req.query.vault);
    if (!vault.valid || !vault.address) {
      res.status(400).json({ error: 'a valid vault address is required' });
      return;
    }
    res.json(v5ClaimProofsRepo.listWinnerProofs(wallet, vault.address).map((row) => ({
      chain_id: row.chainId,
      draw_id: row.drawId,
      distribution_id: row.distributionId,
      leaf_index: row.leafIndex,
      account: row.account,
      token: row.token,
      amount: row.amount,
      kind: row.kind,
      leaf_hash: row.leafHash,
      proof: JSON.parse(row.proof),
      root: row.root,
      draw_manager_address: row.drawManagerAddress,
      claim_manager_address: row.claimManagerAddress,
      vault_address: row.vaultAddress,
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
