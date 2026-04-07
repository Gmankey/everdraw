export const POOL_EVENT_ABI = [
 'event RoundStarted(uint256 indexed roundId, uint64 salesEndTime)',
 'event DrawCommitted(uint256 indexed roundId, uint256 targetBlockNumber)',
 'event WinnerDrawn(uint256 indexed roundId, address indexed winner, uint32 winningTicket)',
 'event UnstakeRequested(uint256 indexed roundId, uint64 completionEpoch, uint256 shmonShares)',
 'event RoundSettled(uint256 indexed roundId, uint256 monReceived, uint256 yieldMON, uint256 lossRatio)',
 'event RoundSkipped(uint256 indexed roundId)',
 'event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid)',
 'event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount)',
 'event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 amount)',
] as const;
