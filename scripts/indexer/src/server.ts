import express from 'express';
import cors from 'cors';
import type { Server } from 'node:http';
import type { IndexerRunner } from './runner/service.js';
import type { RoundsRepo } from './repositories/roundsRepo.js';
import type { WalletRoundsRepo } from './repositories/walletRoundsRepo.js';

export interface ApiServer {
  start(): Promise<Server>;
}

export function createApiServer(params: {
  port: number;
  runner: IndexerRunner;
  roundsRepo: RoundsRepo;
  walletRoundsRepo: WalletRoundsRepo;
  startedAt: number;
}): ApiServer {
  const { port, runner, roundsRepo, walletRoundsRepo, startedAt } = params;
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

  app.get('/api/rounds/:roundId/participants', (req, res) => {
    const roundId = Number(req.params.roundId);
    if (!Number.isFinite(roundId)) {
      res.status(400).json({ error: 'invalid roundId' });
      return;
    }

    const participants = walletRoundsRepo.listByRound(roundId).map((row) => ({
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
