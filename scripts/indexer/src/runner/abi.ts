export const POOL_EVENT_ABI = [
  // ── Shared / legacy (V2Compat) events ───────────────────────────────────
  'event RoundStarted(uint256 indexed roundId, uint64 salesEndTime)',
  'event RoundSkipped(uint256 indexed roundId)',
  'event RoundFailed(uint256 indexed roundId)',

  // ── Legacy V2Compat-only events ──────────────────────────────────────────
  'event DrawCommitted(uint256 indexed roundId, uint256 targetBlockNumber)',
  'event WinnerDrawn(uint256 indexed roundId, address indexed winner, uint32 winningTicket)',
  'event UnstakeRequested(uint256 indexed roundId, uint64 completionEpoch, uint256 shmonShares)',
  // Legacy RoundSettled — no winner field, separate from V2 shape
  'event RoundSettled(uint256 indexed roundId, uint256 monReceived, uint256 yieldMON, uint256 lossRatio)',
  'event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid)',
  // Legacy PrizeClaimed / PrincipalWithdrawn — amount in MON
  'event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount)',
  'event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 amount)',

  // ── V2 (TicketPrizePoolShmonV2) events ───────────────────────────────────
  'event TicketsPurchased(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 costMON, uint256 sharesDeposited, uint256 shareRateAtDeposit, uint8 depositAsset)',
  'event RoundCommitted(uint256 indexed roundId, uint64 targetBlockNumber)',
  // V2 RoundSettled — winner embedded, shares-based financials (different topic hash from legacy)
  'event RoundSettled(uint256 indexed roundId, address indexed winner, uint32 winningTicket, uint256 totalPrincipalMON, uint256 totalShmonShares, uint256 principalShares, uint256 prizeShares, uint256 shareRateAtSettle)',
  // V2 PrizeClaimed / PrincipalWithdrawn — shares-based (different topic hash from legacy)
  'event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 prizeShares, uint256 shareRateAtClaim)',
  'event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 sharesReturned, uint256 shareRateAtWithdraw)',

  // ── V3 (TicketPrizePoolShmonV3) events ───────────────────────────────────
  // TicketsBought, WinnerDrawn, PrizeClaimed(amount), PrincipalWithdrawn(amount),
  // RoundStarted, RoundSkipped share topic hashes with legacy — no new entries needed.
  'event VRFRequested(uint256 indexed roundId, uint64 indexed sequence, uint128 fee)',
  'event VRFFulfilled(uint256 indexed roundId, uint64 indexed sequence, bytes32 randomNumber)',
  // V3 RoundSettled — principalShares + prizeShares, no winner (different topic hash from legacy and V2)
  'event RoundSettled(uint256 indexed roundId, uint256 principalShares, uint256 prizeShares)',
  'event EmergencyForceSettled(uint256 indexed roundId)',

  // ── V4 (TicketPrizePoolV4) events ───────────────────────────────────────
  // TicketsBought, RoundSettled, PrizeClaimed, PrincipalWithdrawn,
  // RoundStarted, RoundSkipped and EmergencyForceSettled share existing
  // signatures above.
  'event RandomnessRequested(uint256 indexed roundId, uint64 indexed requestId, uint128 fee)',
  'event RandomnessFulfilled(uint256 indexed roundId, uint64 indexed requestId, bytes32 randomNumber)',
  'event WinnersDrawn(uint256 indexed roundId, address[] winners, uint32[] winningTickets, uint256[] prizeShares)',
  'event Sponsored(uint256 indexed roundId, address indexed sponsor, uint256 amount, string memo)',
  'event SponsorRefunded(uint256 indexed roundId, address indexed sponsor, uint256 amount)',
  'event TransferDeferred(uint256 indexed rid, address indexed recipient, uint8 slot, uint256 shares)',
  'event DeferredClaimSucceeded(uint256 indexed rid, address indexed recipient, uint8 slot, uint256 shares)',
] as const;
