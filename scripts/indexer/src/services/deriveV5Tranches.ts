import type { RawEventsRepo } from '../repositories/rawEventsRepo.js';
import type { V5TranchesRepo } from '../repositories/v5TranchesRepo.js';
import type { WalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import type { RawEventRow, V5DeploymentScope, V5PoolType, V5PositionAction, V5PositionEventSource } from '../types/domain.js';
import { multiplierForTranche } from './pointsMath.js';

// Locked ticket rate: 0.005 entries/MON/minute (see v5-odds-display-ux ticket).
const ENTRIES_RATE_PER_MON_PER_MIN = 0.005;
const WEI_PER_MON = 1e18;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

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
};

type TransferPayload = {
  from?: string;
  to?: string;
  amount?: string | number;
};

type DerivedPositionEvent = {
  wallet: string;
  poolType: V5PoolType;
  action: V5PositionAction;
  amount: bigint;
  balanceAfter: bigint | null;
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
  walletRoundsRepo?: WalletRoundsRepo,
  configuredScopes: V5DeploymentScope[] = []
): DeriveV5TranchesService {
  return {
    rebuildFromRaw(range) {
      const allEvents = range
        ? rawEventsRepo.getRange(range.fromBlock, range.toBlock)
        : rawEventsRepo.getRange(0, Number.MAX_SAFE_INTEGER);

      const finalizedEvents = allEvents
        .filter((event) => event.finalized === 1)
        .sort(sortEvents);
      const scopes = resolveDeploymentScopes(finalizedEvents, configuredScopes);
      v5TranchesRepo.deleteAll();

      for (const scope of scopes) {
        const roleAddresses = new Set([
          scope.vaultAddress,
          scope.drawManagerAddress,
          scope.claimManagerAddress,
        ]);
        const stackEvents = finalizedEvents.filter((event) =>
          roleAddresses.has(event.contractAddress.toLowerCase())
        );
        const drawWindows = stackEvents
          .filter(
            (event) =>
              event.contractAddress.toLowerCase() === scope.drawManagerAddress &&
              (event.eventName === 'DrawStarted' || event.eventName === 'DrawSkipped')
          )
          .map(toDrawWindow)
          .filter((window): window is DrawWindow => window != null)
          .sort((a, b) => a.periodStart - b.periodStart || a.drawId - b.drawId);
        const drawManagerByDrawId = new Map<number, string>(
          drawWindows.map((window) => [window.drawId, scope.drawManagerAddress])
        );
        const prizeCompoundDeposits = buildPrizeCompoundDeposits(stackEvents);

        for (const event of stackEvents) {
          if (event.contractAddress.toLowerCase() !== scope.vaultAddress) continue;
          const positions = toPositionEvents(event);
          for (const position of positions) {
            v5TranchesRepo.insertPositionEvent({
              txHash: event.txHash,
              logIndex: event.logIndex,
              blockNumber: event.blockNumber,
              blockTimestamp: event.blockTimestamp,
              vaultAddress: scope.vaultAddress,
              wallet: position.wallet,
              poolType: position.poolType,
              action: position.action,
              amount: position.amount.toString(),
              balanceAfter: position.balanceAfter?.toString() ?? null,
              rawEventName: event.eventName,
              source: sourceForPositionEvent(event, position, prizeCompoundDeposits),
            });

            if (position.action === 'deposit' || position.action === 'transfer_in') {
              v5TranchesRepo.insertTranche({
                wallet: position.wallet,
                vaultAddress: scope.vaultAddress,
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
                vaultAddress: scope.vaultAddress,
                poolType: position.poolType,
                amount: position.amount,
                event,
              });
            }
            assertBalanceAfter({
              repo: v5TranchesRepo,
              wallet: position.wallet,
              vaultAddress: scope.vaultAddress,
              poolType: position.poolType,
              expected: position.balanceAfter,
              event,
            });
          }
        }

        if (walletRoundsRepo) {
          writeV5ResolvedBase({
            finalizedEvents: stackEvents.filter(
              (event) => event.contractAddress.toLowerCase() === scope.vaultAddress
            ),
            drawWindows,
            drawManagerByDrawId,
            walletRoundsRepo,
          });
        }
      }
    },
  };
}

function resolveDeploymentScopes(
  events: RawEventRow[],
  configuredScopes: V5DeploymentScope[]
): V5DeploymentScope[] {
  if (configuredScopes.length > 0) {
    return configuredScopes.map(normalizeScope);
  }

  const vaults = uniqueRoleAddresses(events, ['Deposit', 'Withdraw', 'Transfer', 'BoostDeposit', 'BoostWithdraw']);
  const managers = uniqueRoleAddresses(events, ['DrawStarted', 'DrawSkipped', 'SeedReceived', 'RootProposed', 'RootFinalized']);
  const claims = uniqueRoleAddresses(events, ['DistributionRegistered', 'ClaimPaid', 'ClaimDeferred', 'DeferredClaimPaid', 'PrizeCompounded']);

  if (vaults.length === 0 && managers.length === 0 && claims.length === 0) return [];
  if (vaults.length !== 1 || managers.length !== 1 || claims.length > 1) {
    throw new Error(
      `Ambiguous V5 contract roles: vaults=${vaults.join(',')} managers=${managers.join(',')} claims=${claims.join(',')}`
    );
  }
  return [{ chainId: 0, vaultAddress: vaults[0], drawManagerAddress: managers[0], claimManagerAddress: claims[0] ?? '0x0000000000000000000000000000000000000000' }];
}

function normalizeScope(scope: V5DeploymentScope): V5DeploymentScope {
  const normalized = {
    chainId: scope.chainId,
    vaultAddress: scope.vaultAddress.toLowerCase(),
    drawManagerAddress: scope.drawManagerAddress.toLowerCase(),
    claimManagerAddress: scope.claimManagerAddress.toLowerCase(),
  };
  if (new Set([normalized.vaultAddress, normalized.drawManagerAddress, normalized.claimManagerAddress]).size !== 3) {
    throw new Error('Ambiguous V5 contract roles in deployment scope');
  }
  return normalized;
}

function uniqueRoleAddresses(events: RawEventRow[], names: RawEventRow['eventName'][]): string[] {
  const accepted = new Set(names);
  return [...new Set(
    events
      .filter((event) => accepted.has(event.eventName))
      .map((event) => event.contractAddress.toLowerCase())
  )].sort();
}

function buildPrizeCompoundDeposits(events: RawEventRow[]): Set<string> {
  const pendingDeposits = new Map<string, RawEventRow[]>();
  const compoundedDeposits = new Set<string>();

  for (const event of events) {
    if (event.eventName === 'Deposit') {
      const position = toPositionEvents(event)[0];
      if (!position || position.poolType !== 'vault' || position.action !== 'deposit') continue;
      const key = prizeCompoundKey(event.txHash, position.wallet);
      const queue = pendingDeposits.get(key) ?? [];
      queue.push(event);
      pendingDeposits.set(key, queue);
      continue;
    }

    if (event.eventName !== 'PrizeCompounded') continue;
    const payload = JSON.parse(event.payload) as PrizeCompoundedPayload;
    const account = String(payload.account ?? event.wallet ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(account)) continue;
    const key = prizeCompoundKey(event.txHash, account);
    const queue = pendingDeposits.get(key);
    const deposit = queue?.shift();
    if (!deposit) continue;
    compoundedDeposits.add(positionEventKey(deposit));
    if (queue?.length === 0) pendingDeposits.delete(key);
  }

  return compoundedDeposits;
}

function sourceForPositionEvent(
  event: RawEventRow,
  position: { wallet: string; poolType: V5PoolType; action: V5PositionAction; amount: bigint },
  prizeCompoundDeposits: Set<string>
): V5PositionEventSource {
  if (event.eventName === 'Transfer') return 'transfer';
  if (event.eventName !== 'Deposit' || position.action !== 'deposit' || position.poolType !== 'vault') return 'user';
  return prizeCompoundDeposits.has(positionEventKey(event)) ? 'prize_compound' : 'user';
}

function prizeCompoundKey(txHash: string, wallet: string): string {
  return `${txHash.toLowerCase()}:${wallet.toLowerCase()}`;
}

function positionEventKey(event: RawEventRow): string {
  return `${event.txHash.toLowerCase()}:${event.logIndex}`;
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

  if (remaining > 0n) {
    throw new Error(
      `V5 tranche underflow after ${input.event.eventName} ${input.event.txHash}:${input.event.logIndex} ` +
      `wallet=${input.wallet} pool=${input.poolType} missing=${remaining}`
    );
  }
}

function toPositionEvents(event: RawEventRow): DerivedPositionEvent[] {
  if (event.eventName === 'Transfer') {
    const payload = JSON.parse(event.payload) as TransferPayload;
    const from = String(payload.from ?? '').toLowerCase();
    const to = String(payload.to ?? '').toLowerCase();
    const amount = BigInt(String(payload.amount ?? '0'));
    if (amount <= 0n || from === to) return [];

    // Mint/burn transfers mirror Deposit/Withdraw and must not be counted twice.
    if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) return [];
    if (!/^0x[0-9a-f]{40}$/.test(from) || !/^0x[0-9a-f]{40}$/.test(to)) return [];
    return [
      { wallet: from, poolType: 'vault', action: 'transfer_out', amount, balanceAfter: null },
      { wallet: to, poolType: 'vault', action: 'transfer_in', amount, balanceAfter: null },
    ];
  }

  if (!['Deposit', 'Withdraw', 'BoostDeposit', 'BoostWithdraw'].includes(event.eventName)) return [];
  const payload = JSON.parse(event.payload) as PositionPayload;
  const wallet = String(payload.recipient ?? payload.booster ?? event.wallet ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return [];

  const poolType: V5PoolType = event.eventName === 'BoostDeposit' || event.eventName === 'BoostWithdraw' ? 'degen' : 'vault';
  const action: V5PositionAction = event.eventName === 'Deposit' || event.eventName === 'BoostDeposit' ? 'deposit' : 'withdraw';
  return [{
    wallet,
    poolType,
    action,
    amount: BigInt(String(payload.amount ?? '0')),
    balanceAfter: payload.balance == null ? null : BigInt(String(payload.balance)),
  }];
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
    const unix = Math.floor(Date.parse(event.blockTimestamp) / 1000);
    if (!Number.isFinite(unix)) continue;
    for (const position of toPositionEvents(event)) {
      const key = `${position.wallet}:${position.poolType}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        groupMeta.set(key, { wallet: position.wallet, poolType: position.poolType });
      }
      groups.get(key)!.push({ unix, action: position.action, amount: position.amount });
    }
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
      if (ev.action === 'deposit' || ev.action === 'transfer_in') {
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
