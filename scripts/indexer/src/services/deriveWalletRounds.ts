import type { RawEventsRepo } from '../repositories/rawEventsRepo.js';
import type { WalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import type { RawEventRow, WalletRoundRow } from '../types/domain.js';
import { nowIso } from '../utils/time.js';

type WalletRoundAccumulator = {
  poolAddress: string;
  wallet: string;
  roundId: number;
  tickets: number;
  monPaid: bigint;
  won: 0 | 1;
  withdrew: 0 | 1;
  prizeClaimed: bigint;
  principalWithdrawn: bigint;
};

export interface DeriveWalletRoundsService {
  rebuildFromRaw(range?: { fromBlock: number; toBlock: number }): void;
}

export function createDeriveWalletRoundsService(
  rawEventsRepo: RawEventsRepo,
  walletRoundsRepo: WalletRoundsRepo
): DeriveWalletRoundsService {
  return {
    rebuildFromRaw(range) {
      const allEvents = range
        ? rawEventsRepo.getRange(range.fromBlock, range.toBlock)
        : rawEventsRepo.getRange(0, Number.MAX_SAFE_INTEGER);

      const finalizedEvents = allEvents
        .filter((event) => event.finalized === 1)
        .sort(sortEvents);
      const distributionDrawIds = new Map<string, { drawId: number; poolAddress: string }>();
      for (const event of finalizedEvents) {
        if (event.eventName !== 'DistributionRegistered' || event.roundId == null) continue;
        const payload = parsePayload<{ distributionId: string; source?: string }>(event.payload);
        distributionDrawIds.set(payload.distributionId.toLowerCase(), {
          drawId: event.roundId,
          poolAddress: (payload.source ?? event.contractAddress).toLowerCase(),
        });
      }

      const grouped = new Map<string, WalletRoundAccumulator>();

      for (const event of finalizedEvents) {
        let roundId = event.roundId;
        let poolAddress = event.contractAddress;
        if (event.eventName === 'ClaimPaid' || event.eventName === 'ClaimDeferred' || event.eventName === 'DeferredClaimPaid') {
          const payload = parsePayload<{ distributionId: string }>(event.payload);
          const mapped = distributionDrawIds.get(payload.distributionId.toLowerCase());
          if (mapped) {
            roundId = mapped.drawId;
            poolAddress = mapped.poolAddress;
          }
        }
        if (roundId == null) continue;
        if (!event.wallet) continue;

        const acc = getOrCreate(grouped, poolAddress, event.wallet, roundId);

        switch (event.eventName) {
          case 'TicketsBought':
          case 'TicketsPurchased': {
            // Both legacy and V2 payloads are normalized to { roundId, buyer, ticketCount, monPaid }
            const payload = parsePayload<{
              roundId: number;
              buyer: string;
              ticketCount: number;
              monPaid: string | number;
            }>(event.payload);

            acc.tickets += Number(payload.ticketCount ?? 0);
            acc.monPaid += BigInt(stringifyNumberish(payload.monPaid ?? '0'));
            break;
          }

          case 'WinnerDrawn':
            acc.won = 1;
            break;

          case 'RoundSettled': {
            // V2: winner is embedded in RoundSettled payload; mark won for the winning wallet
            const payload = parsePayload<{ winner?: string }>(event.payload);
            if (payload.winner && event.wallet && event.wallet === payload.winner) {
              acc.won = 1;
            }
            break;
          }

          case 'PrincipalWithdrawn': {
            const payload = parsePayload<{
              roundId: number;
              user: string;
              amount: string | number;
            }>(event.payload);

            acc.withdrew = 1;
            acc.principalWithdrawn += BigInt(stringifyNumberish(payload.amount ?? '0'));
            break;
          }

          case 'PrizeClaimed': {
            const payload = parsePayload<{
              roundId: number;
              winner: string;
              amount: string | number;
            }>(event.payload);

            acc.prizeClaimed += BigInt(stringifyNumberish(payload.amount ?? '0'));
            break;
          }

          case 'ClaimPaid': {
            const payload = parsePayload<{
              distributionId: string;
              account: string;
              amount: string | number;
            }>(event.payload);
            acc.won = 1;
            acc.prizeClaimed += BigInt(stringifyNumberish(payload.amount ?? '0'));
            break;
          }

          default:
            break;
        }
      }

      walletRoundsRepo.deleteAll();

      for (const acc of grouped.values()) {
        const now = nowIso();
        const netPosition = acc.principalWithdrawn + acc.prizeClaimed - acc.monPaid;

        const row: WalletRoundRow = {
          wallet: acc.wallet,
          roundId: acc.roundId,
          poolAddress: acc.poolAddress,
          tickets: acc.tickets,
          monPaid: acc.monPaid.toString(),
          won: acc.won,
          withdrew: acc.withdrew,
          prizeClaimed: acc.prizeClaimed.toString(),
          principalWithdrawn: acc.principalWithdrawn.toString(),
          withdrawnAt: null,
          netPosition: netPosition.toString(),
          createdAt: now,
          updatedAt: now,
        };

        walletRoundsRepo.upsert(row);
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
  map: Map<string, WalletRoundAccumulator>,
  poolAddress: string,
  wallet: string,
  roundId: number
): WalletRoundAccumulator {
  const key = `${poolAddress}:${wallet}:${roundId}`;
  const existing = map.get(key);
  if (existing) return existing;

  const created: WalletRoundAccumulator = {
    poolAddress,
    wallet,
    roundId,
    tickets: 0,
    monPaid: 0n,
    won: 0,
    withdrew: 0,
    prizeClaimed: 0n,
    principalWithdrawn: 0n,
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
