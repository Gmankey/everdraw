import type { RawEventsRepo } from '../repositories/rawEventsRepo.js';
import type { V5TranchesRepo } from '../repositories/v5TranchesRepo.js';
import type { WalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import type { RawEventRow, V5PoolType, V5PositionAction, V5PositionEventSource } from '../types/domain.js';
import { multiplierForTranche } from './pointsMath.js';

// Locked ticket rate: 0.005 entries/MON/minute (see v5-odds-display-ux ticket).
const ENTRIES_RATE_PER_MON_PER_MIN = 0.005;
const WEI_PER_MON = 1e18;

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

type PrizeCompoundedPayload = {
  account?: string;
  amount?: string | number;
};

export interface DeriveV5TranchesService {
  rebuildFromRaw(range?: { fromBlock: number; toBlock: number }): void;
}

export function firstFullWeightDrawId(startDrawId: number | null): number | null {
  return startDrawId == null ? null : startDrawId + 1;
}

export function createDeriveV5TranchesService(
  rawEventsRepo: RawEventsRepo,
  v5TranchesRepo: V5TranchesRepo,
  walletRoundsRepo?: WalletRoundsRepo
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

      // Map each V5 draw to the DrawManager that emitted it (= the round's pool_address).
      const drawManagerByDrawId = new Map<number, string>();
      for (const event of finalizedEvents) {
        if (event.eventName !== 'DrawStarted' && event.eventName !== 'DrawSkipped') continue;
        const window = toDrawWindow(event);
        if (window) drawManagerByDrawId.set(window.drawId, event.contractAddress.toLowerCase());
      }

      const prizeCompoundMarkers = buildPrizeCompoundMarkers(finalizedEvents);

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
          source: sourceForPositionEvent(event, position, prizeCompoundMarkers),
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
        assertBalanceAfter({
          repo: v5TranchesRepo,
          wallet: position.wallet,
          vaultAddress: event.contractAddress,
          poolType: position.poolType,
          expected: position.balanceAfter,
          event,
        });
      }

      // Per-wallet per-draw entries → resolved base points (per-tranche tenure multiplier, §2b).
      if (walletRoundsRepo) {
        writeV5ResolvedBase({ finalizedEvents, drawWindows, drawManagerByDrawId, walletRoundsRepo });
      }
    },
  };
}

function buildPrizeCompoundMarkers(events: RawEventRow[]): Map<string, number> {
  const markers = new Map<string, number>();
  for (const event of events) {
    if (event.eventName !== 'PrizeCompounded') continue;
    const payload = JSON.parse(event.payload) as PrizeCompoundedPayload;
    const account = String(payload.account ?? event.wallet ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(account) || payload.amount == null) continue;
    const key = prizeCompoundKey(event.txHash, account, BigInt(String(payload.amount)));
    markers.set(key, (markers.get(key) ?? 0) + 1);
  }
  return markers;
}

function sourceForPositionEvent(
  event: RawEventRow,
  position: { wallet: string; poolType: V5PoolType; action: V5PositionAction; amount: bigint },
  prizeCompoundMarkers: Map<string, number>
): V5PositionEventSource {
  if (event.eventName !== 'Deposit' || position.action !== 'deposit' || position.poolType !== 'vault') return 'user';
  const key = prizeCompoundKey(event.txHash, position.wallet, position.amount);
  const count = prizeCompoundMarkers.get(key) ?? 0;
  if (count <= 0) return 'user';
  if (count === 1) prizeCompoundMarkers.delete(key);
  else prizeCompoundMarkers.set(key, count - 1);
  return 'prize_compound';
}

function prizeCompoundKey(txHash: string, wallet: string, amount: bigint): string {
  return `${txHash.toLowerCase()}:${wallet.toLowerCase()}:${amount.toString()}`;
}

function assertBalanceAfter(input: {
  repo: V5TranchesRepo;
  wallet: string;
  vaultAddress: string;
  poolType: V5PoolType;
  expected: bigint | null;
  event: RawEventRow;
}): void {
  if (input.expected == null) return;
  const actual = BigInt(input.repo.sumOpenRemaining(input.wallet, input.vaultAddress, input.poolType));
  if (actual !== input.expected) {
    throw new Error(
      `V5 tranche balance drift after ${input.event.eventName} ${input.event.txHash}:${input.event.logIndex} ` +
      `wallet=${input.wallet} pool=${input.poolType} expected=${input.expected} actual=${actual}`
    );
  }
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

function findDrawIdUnix(windows: DrawWindow[], unix: number): number | null {
  const match = windows.find((window) => window.periodStart <= unix && unix < window.periodEnd);
  return match?.drawId ?? null;
}

type TrancheState = { remaining: bigint; startDrawId: number | null };
type PosEvent = { unix: number; action: V5PositionAction; amount: bigint };

// For each V5 draw, compute every wallet's resolved base points:
//   resolvedBase = Σ over tranches [ entries_t × multiplierForTranche(t)/100 ]
//   entries_t    = 0.005 × (tranche's time-weighted balance-minutes over [periodStart, periodEnd])
// The tranche multiplier follows each deposit's own tenure (§2b anti-gaming), NOT the account streak.
// Vault and Degen tranches are tracked separately; degen carries the 2→5× ramp, vault the 1→2× curve.
function writeV5ResolvedBase(input: {
  finalizedEvents: RawEventRow[];
  drawWindows: DrawWindow[];
  drawManagerByDrawId: Map<number, string>;
  walletRoundsRepo: WalletRoundsRepo;
}): void {
  const { finalizedEvents, drawWindows, drawManagerByDrawId, walletRoundsRepo } = input;
  if (drawWindows.length === 0) return;
  const windows = [...drawWindows].sort((a, b) => a.periodStart - b.periodStart);
  const maxEnd = Math.max(...windows.map((w) => w.periodEnd));

  // Group ordered position events by wallet + pool.
  const groups = new Map<string, PosEvent[]>();
  const groupMeta = new Map<string, { wallet: string; poolType: V5PoolType }>();
  for (const event of finalizedEvents) {
    const position = toPositionEvent(event);
    if (!position) continue;
    const unix = Math.floor(Date.parse(event.blockTimestamp) / 1000);
    if (!Number.isFinite(unix)) continue;
    const key = `${position.wallet}:${position.poolType}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupMeta.set(key, { wallet: position.wallet, poolType: position.poolType });
    }
    groups.get(key)!.push({ unix, action: position.action, amount: position.amount });
  }

  // resolvedBase[wallet][drawId]
  const resolved = new Map<string, Map<number, number>>();
  const addBase = (wallet: string, drawId: number, value: number) => {
    if (value === 0) return;
    if (!resolved.has(wallet)) resolved.set(wallet, new Map());
    const byDraw = resolved.get(wallet)!;
    byDraw.set(drawId, (byDraw.get(drawId) ?? 0) + value);
  };

  for (const [key, events] of groups) {
    const { wallet, poolType } = groupMeta.get(key)!;
    events.sort((a, b) => a.unix - b.unix);
    const stack: TrancheState[] = [];

    const flushSegment = (t0: number, t1: number) => {
      if (t1 <= t0) return;
      for (const win of windows) {
        const os = Math.max(t0, win.periodStart);
        const oe = Math.min(t1, win.periodEnd);
        if (oe <= os) continue;
        const minutes = (oe - os) / 60;
        for (const tranche of stack) {
          if (tranche.remaining <= 0n) continue;
          const balanceMon = Number(tranche.remaining) / WEI_PER_MON;
          const entries = ENTRIES_RATE_PER_MON_PER_MIN * balanceMon * minutes;
          const mult = multiplierForTranche({
            poolType,
            firstFullWeightDrawId: firstFullWeightDrawId(tranche.startDrawId),
            drawId: win.drawId,
          });
          addBase(wallet, win.drawId, entries * (mult / 100));
        }
      }
    };

    let prevTime: number | null = null;
    for (const ev of events) {
      if (prevTime != null) flushSegment(prevTime, ev.unix);
      if (ev.action === 'deposit') {
        stack.push({ remaining: ev.amount, startDrawId: findDrawIdUnix(windows, ev.unix) });
      } else {
        let remaining = ev.amount;
        for (let i = stack.length - 1; i >= 0 && remaining > 0n; i--) {
          const consumed = stack[i].remaining < remaining ? stack[i].remaining : remaining;
          stack[i].remaining -= consumed;
          remaining -= consumed;
        }
      }
      prevTime = ev.unix;
    }
    // Balance persists after the last event through the end of the final draw window.
    if (prevTime != null) flushSegment(prevTime, maxEnd);
  }

  for (const [wallet, byDraw] of resolved) {
    for (const [drawId, base] of byDraw) {
      const poolAddress = drawManagerByDrawId.get(drawId);
      if (!poolAddress) continue;
      walletRoundsRepo.upsertV5ResolvedBase(wallet, drawId, poolAddress, base);
    }
  }
}
