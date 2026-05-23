import type { RawEventsRepo } from '../repositories/rawEventsRepo.js';
import type { RoundsRepo } from '../repositories/roundsRepo.js';
import type { RawEventRow, RoundRow } from '../types/domain.js';
import { nowIso } from '../utils/time.js';

type RoundAccumulator = {
  roundId: number;
  poolAddress: string;
  state: RoundRow['state'];
  isSkipped: 0 | 1;
  openedAt: string | null;
  salesEndTime: string | null;
  committedAt: string | null;
  drawnAt: string | null;
  unstakingAt: string | null;
  settledAt: string | null;
  depositTotalMon: bigint;
  monReceived: string;
  yieldMon: string;
  lossRatio: string;
  buyerWallets: Set<string>;
  winnerWallets: Set<string>;
  ticketCount: number;
  winner: string | null;
  winningTicket: number | null;
};

export interface DeriveRoundsService {
  rebuildFromRaw(range?: { fromBlock: number; toBlock: number }): void;
}

export function createDeriveRoundsService(
  rawEventsRepo: RawEventsRepo,
  roundsRepo: RoundsRepo
): DeriveRoundsService {
  return {
    rebuildFromRaw(range) {
      const allEvents = range
        ? rawEventsRepo.getRange(range.fromBlock, range.toBlock)
        : rawEventsRepo.getRange(0, Number.MAX_SAFE_INTEGER);

      const finalizedEvents = allEvents
        .filter((event) => event.finalized === 1)
        .filter((event) => event.roundId != null)
        .sort(sortEvents);

      const rounds = new Map<string, RoundAccumulator>();

      for (const event of finalizedEvents) {
        const roundId = event.roundId!;
        const acc = getOrCreate(rounds, event.contractAddress, roundId);

        switch (event.eventName) {
          case 'RoundStarted': {
            const payload = parsePayload<{ roundId: number; salesEndTime?: string | number }>(event.payload);
            acc.state = 'open';
            acc.openedAt = event.blockTimestamp;
            acc.salesEndTime =
              payload.salesEndTime != null
                ? normalizeNumberishTimestamp(payload.salesEndTime)
                : acc.salesEndTime;
            break;
          }

          case 'DrawCommitted':
          case 'RoundCommitted':
            acc.state = 'committed';
            acc.committedAt = event.blockTimestamp;
            break;

          case 'WinnerDrawn': {
            const payload = parsePayload<{ roundId: number; winner: string; winningTicket: number }>(event.payload);
            acc.state = 'drawn';
            acc.drawnAt = event.blockTimestamp;
            acc.winner = payload.winner;
            acc.winningTicket = Number(payload.winningTicket);
            if (event.wallet) acc.winnerWallets.add(event.wallet);
            break;
          }

          case 'UnstakeRequested':
            acc.state = 'unstaking';
            acc.unstakingAt = event.blockTimestamp;
            break;

          case 'RoundSettled': {
            const payload = parsePayload<{
              roundId: number;
              winner?: string;
              winningTicket?: number;
              monReceived: string | number;
              yieldMON: string | number;
              lossRatio: string | number;
            }>(event.payload);

            acc.state = 'settled';
            acc.settledAt = event.blockTimestamp;
            acc.monReceived = stringifyNumberish(payload.monReceived ?? '0');
            acc.yieldMon = stringifyNumberish(payload.yieldMON ?? '0');
            acc.lossRatio = stringifyNumberish(payload.lossRatio ?? '0');
            if (payload.winner) {
              acc.winner = payload.winner.toLowerCase();
              acc.winningTicket = Number(payload.winningTicket ?? 0);
              acc.drawnAt = acc.drawnAt ?? event.blockTimestamp;
              if (event.wallet) acc.winnerWallets.add(event.wallet);
            }
            break;
          }

          case 'RoundSkipped':
          case 'RoundFailed':
            acc.state = 'skipped';
            acc.isSkipped = 1;
            break;

          case 'TicketsBought':
          case 'TicketsPurchased': {
            const payload = parsePayload<{
              roundId: number;
              buyer: string;
              ticketCount: number;
              monPaid: string | number;
            }>(event.payload);

            acc.ticketCount += Number(payload.ticketCount ?? 0);
            acc.depositTotalMon += BigInt(stringifyNumberish(payload.monPaid ?? '0'));
            if (event.wallet) acc.buyerWallets.add(event.wallet);
            break;
          }

          case 'PrizeClaimed':
          case 'PrincipalWithdrawn':
            break;
        }
      }

      roundsRepo.deleteAll();

      for (const acc of rounds.values()) {
        const row: RoundRow = {
          roundId: acc.roundId,
          poolAddress: acc.poolAddress,
          state: acc.state,
          isSkipped: acc.isSkipped,
          openedAt: acc.openedAt,
          salesEndTime: acc.salesEndTime,
          committedAt: acc.committedAt,
          drawnAt: acc.drawnAt,
          unstakingAt: acc.unstakingAt,
          settledAt: acc.settledAt,
          depositTotalMon: acc.depositTotalMon.toString(),
          monReceived: acc.monReceived,
          yieldMon: acc.yieldMon,
          lossRatio: acc.lossRatio,
          ticketCount: acc.ticketCount,
          uniqueWalletCount: acc.buyerWallets.size,
          winnerWalletsCount: acc.winnerWallets.size,
          winner: acc.winner,
          winningTicket: acc.winningTicket,
          updatedAt: nowIso(),
        };

        roundsRepo.upsert(row);
      }
    },
  };
}

function sortEvents(a: RawEventRow, b: RawEventRow): number {
  return a.blockNumber !== b.blockNumber
    ? a.blockNumber - b.blockNumber
    : a.logIndex - b.logIndex;
}

function getOrCreate(
  map: Map<string, RoundAccumulator>,
  poolAddress: string,
  roundId: number
): RoundAccumulator {
  const key = `${poolAddress}:${roundId}`;
  const existing = map.get(key);
  if (existing) return existing;

  const created: RoundAccumulator = {
    roundId,
    poolAddress,
    state: 'open',
    isSkipped: 0,
    openedAt: null,
    salesEndTime: null,
    committedAt: null,
    drawnAt: null,
    unstakingAt: null,
    settledAt: null,
    depositTotalMon: 0n,
    monReceived: '0',
    yieldMon: '0',
    lossRatio: '0',
    buyerWallets: new Set<string>(),
    winnerWallets: new Set<string>(),
    ticketCount: 0,
    winner: null,
    winningTicket: null,
  };

  map.set(key, created);
  return created;
}

function parsePayload<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

function stringifyNumberish(value: string | number): string {
  return String(value);
}

function normalizeNumberishTimestamp(value: string | number): string {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return String(value);
  if (raw < 10_000_000_000) {
    return new Date(raw * 1000).toISOString();
  }
  return new Date(raw).toISOString();
}
