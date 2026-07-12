export type RoundState = 'open' | 'committed' | 'drawn' | 'unstaking' | 'settled' | 'skipped';

export type SupportedEventName =
  // Shared
  | 'RoundStarted'
  | 'RoundSettled'
  | 'RoundSkipped'
  | 'RoundFailed'
  | 'PrizeClaimed'
  | 'PrincipalWithdrawn'
  // Legacy V2Compat-only
  | 'DrawCommitted'
  | 'WinnerDrawn'
  | 'UnstakeRequested'
  | 'TicketsBought'
  // V2-only
  | 'TicketsPurchased'
  | 'RoundCommitted'
  // V3-only
  | 'VRFRequested'
  | 'VRFFulfilled'
  // V4-only
  | 'RandomnessRequested'
  | 'RandomnessFulfilled'
  | 'EmergencyForceSettled'
  // V5 PrizeVault events
  | 'Deposit'
  | 'Withdraw'
  | 'BoostDeposit'
  | 'BoostWithdraw'
  // V5 DrawManager lifecycle events
  | 'DrawStarted'
  | 'DrawSkipped'
  | 'SeedReceived'
  | 'RootProposed'
  | 'RootVetoed'
  | 'RootFinalized'
  | 'DrawEconomicsSnapshot'
  // V5 ClaimManager events
  | 'DistributionRegistered'
  | 'ClaimPaid'
  | 'ClaimDeferred'
  | 'DeferredClaimPaid'
  | 'PrizeCompounded';

export interface RawEventRow {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: string;
  contractAddress: string;
  eventName: SupportedEventName;
  roundId: number | null;
  wallet: string | null;
  amountMon: string | null;
  payload: string;
  finalized: 0 | 1;
  createdAt: string;
}

export interface RoundRow {
  roundId: number;
  poolAddress: string;
  state: RoundState;
  isSkipped: 0 | 1;
  openedAt: string | null;
  salesEndTime: string | null;
  committedAt: string | null;
  drawnAt: string | null;
  unstakingAt: string | null;
  settledAt: string | null;
  depositTotalMon: string;
  monReceived: string;
  yieldMon: string;
  lossRatio: string;
  ticketCount: number;
  uniqueWalletCount: number;
  winnerWalletsCount: number;
  winner: string | null;
  winningTicket: number | null;
  updatedAt: string;
}

export interface WalletRoundRow {
  wallet: string;
  roundId: number;
  poolAddress: string;
  tickets: number;
  monPaid: string;
  won: 0 | 1;
  withdrew: 0 | 1;
  prizeClaimed: string;
  principalWithdrawn: string;
  withdrawnAt: string | null;
  netPosition: string;
  // V5 only: per-tranche-blended resolved base points for this draw (null for legacy rounds).
  v5ResolvedBase?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WalletStatsRow {
  wallet: string;
  totalRounds: number;
  totalTickets: number;
  totalMonPaid: string;
  roundsWon: number;
  roundsWithdrew: number;
  netPosition: string;
  firstRoundId: number | null;
  lastRoundId: number | null;
  lastActiveAt: string | null;
  updatedAt: string;
}

export interface IndexerStateRow {
  key: string;
  value: string;
  updatedAt: string;
}

export interface WalletPointsRow {
  wallet: string;
  lifetimePoints: number;
  hasReceivedFirstDepositBonus: 0 | 1;
  hasReceivedFirstWinBonus: 0 | 1;
  hasReceivedComebackKingBonus: 0 | 1;
  hasReceivedPrizePatronBonus: 0 | 1;
  highestLossStreakBonusAwarded: number;
  highestStreakMilestoneAwarded: number;
  updatedAt: number;
}

export interface WalletStreakRow {
  wallet: string;
  currentStreakWeeks: number;
  longestStreakWeeks: number;
  lastCheckpointUnix: number | null;
  consecutiveNonWins: number;
  consecutiveMissedDraws: number;
  updatedAt: number;
}

export interface WalletRoundPointsRow {
  wallet: string;
  poolAddress: string;
  roundId: number;
  basePoints: number;
  multiplierX100: number;
  bonusesBreakdown: string;
  totalPoints: number;
  awardedAtUnix: number;
}

export type V5PoolType = 'vault' | 'degen';
export type V5PositionAction = 'deposit' | 'withdraw';
export type V5PositionEventSource = 'user' | 'prize_compound';

export interface V5PositionEventRow {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTimestamp: string;
  vaultAddress: string;
  wallet: string;
  poolType: V5PoolType;
  action: V5PositionAction;
  amount: string;
  balanceAfter: string | null;
  rawEventName: SupportedEventName;
  source: V5PositionEventSource;
}

export interface V5TrancheRow {
  id?: number;
  wallet: string;
  vaultAddress: string;
  poolType: V5PoolType;
  amount: string;
  remainingAmount: string;
  openedBlockNumber: number;
  openedLogIndex: number;
  openedAt: string;
  openedTxHash: string;
  startDrawId: number | null;
  closedAt: string | null;
  closedBlockNumber: number | null;
  closedLogIndex: number | null;
  closedTxHash: string | null;
}
