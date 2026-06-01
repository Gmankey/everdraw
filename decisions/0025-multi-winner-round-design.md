# ADR-0025: Multi-Winner Round Design (V4)

**Status:** Accepted as design spec for V4. No V3 contract changes.
**Date:** 2026-05-31
**Deciders:** Owner
**Sequence:** First of the V4 design ADRs. Shapes round storage that all other V4 features (multi-asset, sponsor accounting, fee router) must fit around. Must land before ADR-0024 implementation.

---

## Context

V3 contracts pick exactly one winner per round (`winningTicket = randomNumber % totalTickets`, single `winner` field, single `prizeShares` allocation, single `prizeClaimed` boolean). This is correct for the current product but precludes major Phase 3-5 vision items:

- **Cross-protocol mega draws** require large jackpots split across multiple winners (top-1 plus runners-up) to be psychologically marketable
- **Stablecoin vaults** historically use multi-winner allocations (PoolTogether-style) because the variance of a single fat winner is unappealing when yields are smaller
- **Branded partner vaults** want to choose their own winner-count and allocation shape — a high-frequency casual vault may want top-10 evenly, while a flagship monthly draw may want winner-takes-all

V3 storage cannot accommodate any of this without redeploying. This ADR defines the V4 round shape so we can lock it in once and never revisit storage layout.

---

## Decision

### 1. Number of winners is fixed per vault at deploy time

`numWinners` is a constructor argument, stored as a `uint8` constant per vault. Range `1..32`. Default for backward-compatible vaults: `1` (matches V3 behavior). Stablecoin / casual vaults may use `3`, `5`, or `10`. The 32 cap is a hard ceiling to bound on-chain selection cost.

**Not per-round configurable.** Per-round changes were considered (matching the fee snapshot pattern from ADR-0020) and rejected because:
- It introduces an owner attack vector ("owner changes numWinners to 1 in the round they bought into, sees the random number bias their odds")
- It requires extra storage in the `RoundData` struct that pays for itself only if used
- Most vault use-cases want the winner shape to be a stable property of the vault (predictability sells)

If the operator later needs a different winner-count shape, they deploy a new vault. Vaults are cheap relative to design discipline.

### 2. Allocation is fixed per vault at deploy time

`winnerAllocationBps` is a constructor argument, stored as a `uint16[]` constant per vault, summing to exactly `10_000`. Length must equal `numWinners`. Examples:

- Single winner: `[10000]`
- Top-3 Powerball-ish: `[6000, 2500, 1500]`
- Top-5 even: `[2000, 2000, 2000, 2000, 2000]`
- Top-10 evenly weighted: `[1000, ..., 1000]`

Validated in constructor (`sum == 10000` and `length == numWinners`). Stored as immutable.

**Same reasoning as numWinners** — not per-round configurable. Predictable allocation is part of the vault's identity.

### 3. Winner selection algorithm: rejection-sampling extraction

Given `bytes32 randomNumber` from Pyth Entropy and `uint32 totalTickets`, derive `numWinners` distinct winning tickets as follows:

```solidity
function _selectWinners(bytes32 randomNumber, uint32 totalTickets, uint8 numWinners)
    internal pure returns (uint32[] memory tickets)
{
    require(numWinners > 0, "no winners config");
    require(totalTickets >= numWinners, "not enough tickets");  // see Edge Cases §5.1

    tickets = new uint32[](numWinners);
    bytes32 seed = randomNumber;
    uint8 placed = 0;
    uint16 attempts = 0;

    while (placed < numWinners) {
        require(attempts < type(uint16).max, "selection exhausted"); // safety; in practice ≤ ~50 for any realistic N

        // Derive next candidate
        seed = keccak256(abi.encodePacked(seed, attempts));
        uint32 candidate = uint32(uint256(seed) % uint256(totalTickets));

        // Check uniqueness against already-placed
        bool duplicate = false;
        for (uint8 i = 0; i < placed; i++) {
            if (tickets[i] == candidate) { duplicate = true; break; }
        }

        if (!duplicate) {
            tickets[placed] = candidate;
            placed++;
        }
        attempts++;
    }
}
```

Properties:

- **Cryptographically clean.** Each new candidate is derived from a fresh keccak of the prior state, so candidates are independent draws from a uniform distribution over `[0, totalTickets)`.
- **Bounded gas.** For `numWinners ≤ 32`, expected `attempts` is small (collision probability is < 32/totalTickets per draw at the worst). The `attempts < uint16.max` safety bound is a backstop; in practice it's reached only if `totalTickets ≈ numWinners` (which is itself an edge case we cap, see §5.1).
- **No bias.** Modulo bias on `uint256 % uint32` is negligible (`< 2^-220`) for any realistic `totalTickets`.
- **Deterministic.** Given the same `(randomNumber, totalTickets, numWinners)`, anyone can re-derive the same set of winners off-chain to verify.

**Rejected alternatives:**

- **Fisher-Yates shuffle of all `totalTickets`.** O(totalTickets) storage and gas. Catastrophic at any realistic ticket count (millions).
- **Sequential extraction from bytes32 slices.** Splitting 256 bits into `numWinners` slices works only for `numWinners ≤ ~8` and `totalTickets < 2^32`. Doesn't extend cleanly to 32 winners.
- **N independent VRF requests.** Each costs 0.77 MON × N. Cost-prohibitive and adds N callbacks worth of failure modes.

### 4. Storage shape

`RoundData` struct adds:

```solidity
// V4 multi-winner extension
uint32[] winningTickets;  // length = numWinners, set in finalizeDraw
address[] winners;        // length = numWinners, derived from winningTickets
mapping(uint8 => bool) prizeClaimedAt;  // per-position claim flag (replaces prizeClaimed bool)
```

The existing `prizeShares` field becomes "total net prize shares" (gross minus fee). Per-winner shares are computed at claim time from `prizeShares × winnerAllocationBps[position] / 10000`.

The existing single `address winner` and `uint32 winningTicket` fields are **removed** in V4 — they're now arrays. The single-winner case has `winners.length == 1`, `winningTickets.length == 1`. No special-cased fork in the code.

Storage cost per round: ~32 bytes × numWinners (winningTickets array slot + offset) + 32 bytes × numWinners (winners array). For 10 winners that's ~640 bytes extra per round. Negligible.

### 5. Edge cases

#### 5.1. `totalTickets < numWinners`

The round cannot pay `numWinners` distinct winners because not enough tickets exist. Options considered:

- **Revert at finalize time** — terrible UX. The round is locked.
- **Roll the prize over to the next round** — meaningful design choice but introduces "prize accumulator" state that affects subsequent rounds' fee calculations. Adds complexity.
- **Pay only `totalTickets` winners, distribute the un-allocated share back to depositors** — clean and matches "no-loss" branding. The unallocated allocation BPS becomes additional principal-fair-value-return for all depositors at settlement.

**Decision: option 3.** Pay only `min(numWinners, totalTickets)` winners. The unfilled allocation slots' BPS sum becomes a `forfeitBps` that increases the principal-fair-value-return for all depositors at `withdrawPrincipal` time. Treats the no-loss promise as inviolable even under "too few tickets" pathologies.

Implementation: `finalizeDraw` checks `if (totalTickets < numWinners) effectiveN = totalTickets` and computes `forfeitBps = sum(winnerAllocationBps[effectiveN..])`. Stored on the round. Used by `withdrawPrincipal` to add proportional bonus shares to each depositor's return.

#### 5.2. Same buyer holds tickets that get picked multiple times

A single buyer can hold ticket ranges that the algorithm selects more than once (e.g., they bought tickets 50–99 of 100 and the algorithm picks 60, 75, 90). They legitimately win N times.

**Decision: allow.** Their probability is proportional to their ticket count exactly as in the single-winner case. Multi-winning a single round is just compounding good luck. No deduplication at the buyer level.

The frontend should display "you won 3 prizes in round 47" clearly. Indexer should aggregate per-winner-per-round for display.

#### 5.3. Allocation rounding

Integer division on `prizeShares × allocBps / 10000` can round down. Sum of allocations may be one-or-two shares short of `prizeShares` due to rounding. The leftover (≤ numWinners shares) accumulates in the contract.

**Decision: assign rounding leftover to position 0 (largest winner).** Position 0 gets `prizeShares - sum(positions 1..N-1)` so the math always sums exactly. This is cleaner than leaving dust in the contract and aligns with intuition (top winner gets "any extras").

#### 5.4. Fee timing relative to allocation

Per ADR-0020, the protocol fee is computed from gross prize shares and transferred to `feeRecipient` at settlement, with net prize remaining for claim. With multi-winner:

`feeShares = grossPrizeShares × roundFeeBps / 10_000`  
`netPrizeShares = grossPrizeShares − feeShares`  
`winnerShares[i] = netPrizeShares × winnerAllocationBps[i] / 10_000` (with position-0 rounding bonus)

The fee is taken once, before allocation. Each winner sees `(grossPrizeShares × allocBps_i × (1 - feeBps)) / 10_000^2` net.

#### 5.5. Multi-winner indexer events

Replace the single `WinnerDrawn(roundId, winner, winningTicket)` event with:

```solidity
event WinnersDrawn(uint256 indexed roundId, address[] winners, uint32[] winningTickets);
```

Single event for the whole settlement, easier for the indexer to derive the round outcome in one pass. Per-winner claim events stay as the existing `PrizeClaimed(roundId, winner, amount)` shape but now fire N times per round (one per claim).

The V3 `WinnerDrawn` topic hash changes when the signature changes. Per ADR-0021's lesson, this is a new event for V4 vaults only; V3 vaults keep emitting the V3 `WinnerDrawn`. The indexer learns both.

### 6. Claim flow

Each winner calls `claimPrize(uint256 rid)`. The contract resolves which position(s) `msg.sender` holds in the `winners[]` array, claims any unclaimed ones, and transfers the sum.

```solidity
function claimPrize(uint256 rid) external nonReentrant {
    RoundData storage r = rounds[rid];
    if (r.state != RoundState.Settled) revert BadState();

    uint256 totalShares = 0;
    for (uint8 i = 0; i < r.winners.length; i++) {
        if (r.winners[i] == msg.sender && !r.prizeClaimedAt[i]) {
            r.prizeClaimedAt[i] = true;
            uint256 share = _winnerShareAt(r, i);
            totalShares += share;
        }
    }

    if (totalShares == 0) revert NothingToClaim();
    totalUnclaimedShares -= totalShares;
    bool ok = shmon.transfer(msg.sender, totalShares);
    require(ok, "transfer failed");
    emit PrizeClaimed(rid, msg.sender, totalShares);
}
```

A single call claims all of the caller's positions in one transaction. If the same address won positions 0 and 5, they both clear in one claim. No N-claim-tx burden on multi-winning addresses.

### 7. Interaction with sponsor design (ADR-0026, future)

The total prize pool at settlement may include sponsor contributions (ADR-0026). Multi-winner allocation applies to the **total** prize pool (depositor yield + sponsor contributions), not to depositor yield alone. The fee, however, applies only to depositor yield — sponsor contributions are passed through 100% to winners. This requires ADR-0026's storage to separate `depositorPrizeShares` from `sponsoredPrizeShares`. Documented here so the V4 storage layout accommodates both.

---

## Consequences

### Contract

- New constructor parameters: `numWinners`, `winnerAllocationBps`. Validation in constructor.
- New view: `getRoundWinners(rid)` returning the arrays.
- `RoundData` struct grows by two dynamic arrays + a per-position mapping. Storage cost per round goes up by ~`numWinners × 64 bytes`.
- `claimPrize` becomes idempotent at the position level (each position can be claimed at most once) but addresses can call it multiple times if they win multiple positions.
- `finalizeDraw` gas cost grows by ~`numWinners × 20k gas` (selection loop + storage writes). For `numWinners == 10` this is ~200k extra gas — a real cost for high-N vaults, acceptable for low-N. Operators choosing high-N should be aware.
- ABI changes are not backward-compatible. Frontend and indexer must handle V3 vs V4 vaults distinctly.

### Indexer

- New `WinnersDrawn` event signature → new topic hash → ABI update required.
- `wallet_rounds` table needs a `won_positions` column (uint8 bitmask or array) to track which positions a wallet won.
- `rounds` table needs winners-array storage. Either a related `round_winners` table or a JSON column.
- Stats aggregation must handle wallets that won multiple positions in one round.

### Frontend

- Round result display must show N winners with their allocations.
- Winners view replaces "Winner: 0x..." with a ranked list "1st: 0x..., 2nd: 0x..., 3rd: 0x...".
- MyRounds row for a wallet that won multiple positions in one round should show "Won (2 prizes)" not "Won" — clearer UX.
- Buy-ticket card may want to show "top 3 prizes" copy where applicable.

### Audit scope

V4 audit must specifically cover:

- The selection-loop bound (collision probability bounds, attempts bound)
- The forfeitBps math under `totalTickets < numWinners`
- The rounding-to-position-0 path (no over-claim)
- The claim flow for multi-position wins (no double-claim of one position)
- The fee × allocation interaction (no precision loss attacks)
- The `WinnersDrawn` event being emitted before any winner can `claimPrize`

---

## Rejected alternatives

**Per-round configurable winners.** Considered: owner-set per-vault default plus optional per-round override snapshotted at round open (analogous to fee). Rejected because the surface adds owner attack vectors (manipulate winner-count in a round the owner participates in) and the snapshot mechanism doesn't fully mitigate them — even with a snapshot the owner is signaling pre-deposit that "this round is single-winner" and depositors who buy in can be re-targeted in subsequent rounds. Cleaner to make the winner shape a vault-level identity property.

**Merkle-tree winner list.** Considered for very-high-N use cases (top-100, top-1000 raffles). Allows O(log N) claim verification but adds Merkle-root construction at finalize time, off-chain proof generation, and a different claim function shape. Rejected as overkill for current vision (no use-case yet demands > 32 winners). Re-visit if a "thousand-prize" campaign concept emerges in Phase 4.

**Roll-over for the `totalTickets < numWinners` case.** Considered: leftover prize gets added to next round's pot. Rejected because (a) breaks "no-loss" promise — depositors in the current round don't get back the full value if they happened to be the only N-1 depositors, and (b) introduces cross-round accounting state that makes audit harder. Forfeit-to-principal is cleaner.

**Equal allocation only (forbid uneven splits).** Considered for simplicity. Rejected because uneven splits are a real product differentiator (Powerball vs lotto-style) and the implementation cost is the same — a `uint16[]` either way.

**N separate VRF requests.** Considered for cryptographic independence per winner. Rejected because (a) cost (0.77 × N MON per round), (b) each VRF request is a separate Pyth callback failure mode, (c) the keccak-extraction scheme is already cryptographically independent given a single high-entropy seed.

**Fixed `numWinners = 3` for all V4 vaults.** Considered for simplicity. Rejected because Phase 4 marketplace vision specifically calls out vault diversity as a feature. Making winner-count a per-vault config is necessary for that vision.

---

## Open questions

1. **Default `numWinners` for a "stables vault"?** Industry convention varies. PoolTogether uses tiered distributions with many small winners. Lotterino uses top-3. Suggest top-3 (`[6000, 2500, 1500]`) as a reasonable default and let per-vault deploys adjust. Pin down before ADR-0024 implementation.

2. **Should `forfeitBps` from the `totalTickets < numWinners` case go to depositors pro-rata or to the protocol fee recipient?** Argument for depositors: matches no-loss intent. Argument for fee recipient: simpler accounting. **Provisional decision: depositors pro-rata** (consistent with no-loss branding). Revisit if implementation cost becomes high.

3. **Multi-winning a single position via the same address being picked twice from disjoint ticket ranges** — already addressed in §5.2 (allow). But should the indexer surface this prominently in the winners view, or just show the address once with an aggregated prize? **Provisional: show once aggregated.** Easier UX, no information lost (the tickets that won are still on-chain).

4. **Tie-breaking on the rounding bonus when position 0 is held by an address that also holds position 1.** No tie to break — they get both shares plus the rounding bonus on position 0. The rounding bonus is structural, not random. No issue.

These can be settled in implementation discussions; none block the design decision.
