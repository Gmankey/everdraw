import type { RawEventsRepo } from '../repositories/rawEventsRepo.js';
import type { V5TranchesRepo } from '../repositories/v5TranchesRepo.js';
import type { RawEventRow, V5PoolType, V5PositionAction } from '../types/domain.js';

type DrawWindow = {
  drawId: number;
  periodStart: number;
  periodEnd: number;
};

type PositionPayload = {
  recipient?: string;
  booster?: string;
  amount: string | number;
  balance?: string | number;
};

export interface DeriveV5TranchesService {
  rebuildFromRaw(range?: { fromBlock: number; toBlock: number }): void;
}

export function createDeriveV5TranchesService(
  rawEventsRepo: RawEventsRepo,
  v5TranchesRepo: V5TranchesRepo
): DeriveV5TranchesService {
  return {
    rebuildFromRaw(range) {
      const allEvents = range
        ? rawEventsRepo.getRange(range.fromBlock, range.toBlock)
        : rawEventsRepo.getRange(0, Number.MAX_SAFE_INTEGER);

      const finalizedEvents = allEvents
        .filter((event) => event.finalized === 1)
        .sort(sortEvents);
      const drawWindows = finalizedEvents
        .filter((event) => event.eventName === 'DrawStarted' || event.eventName === 'DrawSkipped')
        .map(toDrawWindow)
        .filter((window): window is DrawWindow => window != null)
        .sort((a, b) => a.periodStart - b.periodStart || a.drawId - b.drawId);

      v5TranchesRepo.deleteAll();

      for (const event of finalizedEvents) {
        const position = toPositionEvent(event);
        if (!position) continue;

        v5TranchesRepo.insertPositionEvent({
          txHash: event.txHash,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber,
          blockTimestamp: event.blockTimestamp,
          vaultAddress: event.contractAddress,
          wallet: position.wallet,
          poolType: position.poolType,
          action: position.action,
          amount: position.amount.toString(),
          balanceAfter: position.balanceAfter?.toString() ?? null,
          rawEventName: event.eventName,
        });

        if (position.action === 'deposit') {
          v5TranchesRepo.insertTranche({
            wallet: position.wallet,
            vaultAddress: event.contractAddress,
            poolType: position.poolType,
            amount: position.amount.toString(),
            remainingAmount: position.amount.toString(),
            openedBlockNumber: event.blockNumber,
            openedLogIndex: event.logIndex,
            openedAt: event.blockTimestamp,
            openedTxHash: event.txHash,
            startDrawId: findDrawId(drawWindows, event.blockTimestamp),
            closedAt: null,
            closedBlockNumber: null,
            closedLogIndex: null,
            closedTxHash: null,
          });
        } else {
          consumeNewestTranches({
            repo: v5TranchesRepo,
            wallet: position.wallet,
            vaultAddress: event.contractAddress,
            poolType: position.poolType,
            amount: position.amount,
            event,
          });
        }
      }
    },
  };
}

function consumeNewestTranches(input: {
  repo: V5TranchesRepo;
  wallet: string;
  vaultAddress: string;
  poolType: V5PoolType;
  amount: bigint;
  event: RawEventRow;
}): void {
  let remaining = input.amount;
  const open = input.repo.listOpenNewestFirst(input.wallet, input.vaultAddress, input.poolType);

  for (const tranche of open) {
    if (remaining <= 0n) break;
    const current = BigInt(tranche.remainingAmount);
    if (current <= 0n || tranche.id == null) continue;

    const consumed = current < remaining ? current : remaining;
    const nextRemaining = current - consumed;
    remaining -= consumed;

    input.repo.updateTrancheRemaining({
      id: tranche.id,
      remainingAmount: nextRemaining.toString(),
      closedAt: nextRemaining === 0n ? input.event.blockTimestamp : null,
      closedBlockNumber: nextRemaining === 0n ? input.event.blockNumber : null,
      closedLogIndex: nextRemaining === 0n ? input.event.logIndex : null,
      closedTxHash: nextRemaining === 0n ? input.event.txHash : null,
    });
  }
}

function toPositionEvent(event: RawEventRow): {
  wallet: string;
  poolType: V5PoolType;
  action: V5PositionAction;
  amount: bigint;
  balanceAfter: bigint | null;
} | null {
  if (!['Deposit', 'Withdraw', 'BoostDeposit', 'BoostWithdraw'].includes(event.eventName)) return null;
  const payload = JSON.parse(event.payload) as PositionPayload;
  const wallet = String(payload.recipient ?? payload.booster ?? event.wallet ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return null;

  const poolType: V5PoolType = event.eventName === 'BoostDeposit' || event.eventName === 'BoostWithdraw' ? 'degen' : 'vault';
  const action: V5PositionAction = event.eventName === 'Deposit' || event.eventName === 'BoostDeposit' ? 'deposit' : 'withdraw';
  return {
    wallet,
    poolType,
    action,
    amount: BigInt(String(payload.amount ?? '0')),
    balanceAfter: payload.balance == null ? null : BigInt(String(payload.balance)),
  };
}

function toDrawWindow(event: RawEventRow): DrawWindow | null {
  const payload = JSON.parse(event.payload) as {
    drawId?: number;
    periodStart?: string | number;
    periodEnd?: string | number;
  };
  if (payload.drawId == null || payload.periodStart == null || payload.periodEnd == null) return null;
  return {
    drawId: Number(payload.drawId),
    periodStart: Number(payload.periodStart),
    periodEnd: Number(payload.periodEnd),
  };
}

function findDrawId(windows: DrawWindow[], isoTimestamp: string): number | null {
  const unix = Math.floor(Date.parse(isoTimestamp) / 1000);
  if (!Number.isFinite(unix)) return null;
  const match = windows.find((window) => window.periodStart <= unix && unix < window.periodEnd);
  return match?.drawId ?? null;
}

function sortEvents(a: RawEventRow, b: RawEventRow): number {
  return a.blockNumber !== b.blockNumber
    ? a.blockNumber - b.blockNumber
    : a.logIndex - b.logIndex;
}
