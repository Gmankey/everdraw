export type RoundState = 'open' | 'committed' | 'drawn' | 'unstaking' | 'settled' | 'skipped';

export type SupportedEventName =
  | 'RoundStarted'
  | 'DrawCommitted'
  | 'WinnerDrawn'
  | 'UnstakeRequested'
  | 'RoundSettled'
  | 'RoundSkipped'
  | 'TicketsBought'
  | 'PrizeClaimed'
  | 'PrincipalWithdrawn';

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
