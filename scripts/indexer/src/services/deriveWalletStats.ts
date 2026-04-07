import type { WalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import type { WalletStatsRepo } from '../repositories/walletStatsRepo.js';
import type { WalletStatsRow } from '../types/domain.js';
import { nowIso } from '../utils/time.js';

export interface DeriveWalletStatsService {
  rebuild(): void;
}

export function createDeriveWalletStatsService(
  walletRoundsRepo: WalletRoundsRepo,
  walletStatsRepo: WalletStatsRepo
): DeriveWalletStatsService {
  return {
    rebuild() {
      const allRows = walletRoundsRepo.listAll();
      const grouped = new Map<string, typeof allRows>();

      for (const row of allRows) {
        const existing = grouped.get(row.wallet) ?? [];
        existing.push(row);
        grouped.set(row.wallet, existing);
      }

      const now = nowIso();
      const output: WalletStatsRow[] = [];

      for (const [wallet, rows] of grouped.entries()) {
        const sorted = [...rows].sort((a, b) => a.roundId - b.roundId);
        const totalRounds = rows.length;
        const totalTickets = rows.reduce((sum, row) => sum + row.tickets, 0);
        const totalMonPaid = rows.reduce((sum, row) => sum + BigInt(row.monPaid), 0n);
        const roundsWon = rows.reduce((sum, row) => sum + row.won, 0);
        const roundsWithdrew = rows.reduce((sum, row) => sum + row.withdrew, 0);
        const netPosition = rows.reduce((sum, row) => sum + BigInt(row.netPosition), 0n);

        output.push({
          wallet,
          totalRounds,
          totalTickets,
          totalMonPaid: totalMonPaid.toString(),
          roundsWon,
          roundsWithdrew,
          netPosition: netPosition.toString(),
          firstRoundId: sorted[0]?.roundId ?? null,
          lastRoundId: sorted[sorted.length - 1]?.roundId ?? null,
          lastActiveAt: now,
          updatedAt: now,
        });
      }

      walletStatsRepo.replaceAll(output);
    },
  };
}
