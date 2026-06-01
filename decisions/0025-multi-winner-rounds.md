# ADR-0025 — Multi-Winner Rounds (V4)

**Status:** Accepted as V4 spec.
**Date:** 2026-05-31
**Parent:** ADR-0024 (V4 contract spec)

## Context

V3 picks one winner per round. Phase 3 vision wants top-N distribution (mega draws, casual stablecoin vaults with smaller-but-more-frequent prizes). Round storage is the foundational change everything else fits around.

## Decision

### Per-vault fixed config

```solidity
uint8 public immutable numWinners;            // 1..32
uint16[] public immutable winnerAllocationBps; // length == numWinners, sum == 10000
```

Set at construction, never mutated. Different vaults can have different shapes; one vault's shape is its identity.

### Selection algorithm

Rejection-sampling keccak extraction from the single Pyth random number:

```solidity
function _selectWinners(bytes32 randomNumber, uint32 totalTickets, uint8 numWinners)
    internal pure returns (uint32[] memory tickets)
{
    require(totalTickets > 0, "no tickets");
    uint8 effectiveN = totalTickets < numWinners ? uint8(totalTickets) : numWinners;
    tickets = new uint32[](effectiveN);
    bytes32 seed = randomNumber;
    uint8 placed = 0;
    uint16 attempts = 0;
    while (placed < effectiveN) {
        require(attempts < 1024, "selection exhausted"); // safety bound
        seed = keccak256(abi.encodePacked(seed, attempts));
        uint32 candidate = uint32(uint256(seed) % uint256(totalTickets));
        bool dup = false;
        for (uint8 i = 0; i < placed; i++) {
            if (tickets[i] == candidate) { dup = true; break; }
        }
        if (!dup) { tickets[placed] = candidate; placed++; }
        attempts++;
    }
}
```

Properties:
- Each candidate is an independent uniform draw from `[0, totalTickets)` (keccak of prior seed + counter)
- Modulo bias is negligible (`totalTickets / 2^256 < 2^-220`)
- For any practical `numWinners ≤ 32` and `totalTickets ≥ numWinners + 4`, expected attempts < 50
- Hard cap `attempts < 1024` is a backstop, never reached in practice

### Allocation math

```solidity
grossPrizeShares       // yield earned during the round, after sponsor and fee
feeShares = sum over feeRecipients (gross × feeBps / 10000)  // ADR-0027
netPrize = grossPrizeShares - feeShares + sponsoredPrize     // ADR-0026

For position i in [0, effectiveN-1):
    winnerPrizeShares[i] = netPrize × winnerAllocationBps[i] / 10000

Position 0 absorbs rounding:
    winnerPrizeShares[0] = netPrize - sum(winnerPrizeShares[1..effectiveN-1])

When effectiveN < numWinners (too few tickets):
    forfeitBps = sum(winnerAllocationBps[effectiveN..numWinners-1])
    Each depositor's withdraw bonus = principalReturn × forfeitBps / 10000
```

The forfeit-to-depositors path preserves the no-loss promise even in pathological "too few tickets" rounds.

### Storage

```solidity
struct RoundData {
    // ... lifecycle and accounting from V3 ...
    uint32[] winningTickets;     // length effectiveN
    address[] winners;            // length effectiveN
    uint256[] winnerPrizeShares; // length effectiveN, pre-computed at finalize
    mapping(uint8 => bool) prizeClaimedAt;
    uint16 forfeitBps;
}
```

`winnerPrizeShares` is pre-computed so each winner's `claimPrize` is O(1) gas regardless of position.

### Events

```solidity
event WinnersDrawn(
    uint256 indexed roundId,
    address[] winners,
    uint32[] winningTickets,
    uint256[] prizeShares
);

// Existing PrizeClaimed fires once per claim
event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);
```

Single `WinnersDrawn` event per settlement (not N separate `WinnerDrawn` events) so the indexer can decode the full result in one log.

### Claim flow

```solidity
function claimPrize(uint256 rid) external nonReentrant {
    RoundData storage r = rounds[rid];
    if (r.state != RoundState.Settled) revert BadState();
    uint256 totalShares = 0;
    for (uint8 i = 0; i < r.winners.length; i++) {
        if (r.winners[i] == msg.sender && !r.prizeClaimedAt[i]) {
            r.prizeClaimedAt[i] = true;
            totalShares += r.winnerPrizeShares[i];
        }
    }
    if (totalShares == 0) revert NothingToClaim();
    _transferOrDefer(msg.sender, totalShares, rid, 0xff); // ADR-0028 deferred-claim path
    emit PrizeClaimed(rid, msg.sender, totalShares);
}
```

One call drains all of caller's positions. Idempotent per-position. The `_transferOrDefer` indirection is ADR-0028's try/catch wrapper.

### Edge cases (locked)

- **Same buyer wins multiple positions**: allowed, aggregated in single claim call. Display surfaces this in UI.
- **Rounding leftover**: assigned to position 0.
- **`totalTickets < numWinners`**: only `effectiveN = totalTickets` winners selected. Unallocated bps becomes `forfeitBps`, distributed pro-rata to depositors on withdraw.
- **Zero-yield round with sponsorship**: sponsored amount is still split per allocation. Sponsor's contribution can produce winners even when yield is zero.
- **Sponsor address wins their own sponsored prize**: allowed. Same as any depositor winning.

## Consequences

Storage cost per round: ~`numWinners × 96 bytes` extra. For 10 winners that's ~1KB. Negligible.

Settlement gas: ~`numWinners × 25k gas` for selection + storage writes. For 10 winners: ~250k extra gas. Operator picks the number; high-N vaults pay more.

Claim gas: O(numWinners) per claim because we iterate winners array. For 32 winners worst-case ~50k gas — still acceptable.

Audit must verify: selection uniqueness, gas bound holds, no off-by-one in `effectiveN` handling, forfeitBps integrates correctly with withdrawPrincipal.

## Rejected alternatives

- Per-round configurable winners: owner attack surface
- Merkle-tree winner lists: overkill at N ≤ 32
- N independent VRF requests: cost-prohibitive
- Roll-over on `totalTickets < numWinners`: breaks no-loss promise
- Fisher-Yates over full ticket set: O(totalTickets) gas, catastrophic at scale
