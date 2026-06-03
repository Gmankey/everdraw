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
  | 'EmergencyForceSettled';

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
  hasReceivedOnTheDoubleBonus: 0 | 1;
  hasReceivedComebackKingBonus: 0 | 1;
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
