export const POOL_EVENT_ABI = [
  // RoundStarted is shared by legacy and V2.
  'event RoundStarted(uint256 indexed roundId, uint64 salesEndTime)',

  // Commit events differ by contract family.
  'event DrawCommitted(uint256 indexed roundId, uint256 targetBlockNumber)',
  'event RoundCommitted(uint256 indexed roundId, uint64 targetBlockNumber)',

  // Winner / settlement events.
  'event WinnerDrawn(uint256 indexed roundId, address indexed winner, uint32 winningTicket)',
  'event UnstakeRequested(uint256 indexed roundId, uint64 completionEpoch, uint256 shmonShares)',
  'event RoundSettled(uint256 indexed roundId, uint256 monReceived, uint256 yieldMON, uint256 lossRatio)',
  'event RoundSettled(uint256 indexed roundId, address indexed winner, uint32 winningTicket, uint256 totalPrincipalMON, uint256 totalShmonShares, uint256 principalShares, uint256 prizeShares, uint256 shareRateAtSettle)',

  // Terminal non-settled rounds.
  'event RoundSkipped(uint256 indexed roundId)',
  'event RoundFailed(uint256 indexed roundId)',

  // Buys.
  'event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid)',
  'event TicketsPurchased(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 costMON, uint256 sharesDeposited, uint256 shareRateAtDeposit, uint8 depositAsset)',

  // Claim / withdraw events differ in amount field names.
  'event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount)',
  'event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 prizeShares, uint256 shareRateAtClaim)',
  'event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 amount)',
  'event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 sharesReturned, uint256 shareRateAtWithdraw)',
] as const;
