# ADR-0037 — V4/V4.1 cadence-drift defect: rolling schedule violates ADR-0001/0010

**Status:** Accepted (defect record — not fixable in V4/V4.1, mandatory gate for V5)
**Date:** 2026-06-16
**Deciders:** Operator (PM)
**Relates to:** ADR-0001 (two-vault staggered cadence), ADR-0010 (cadence invariant), ADR-0036 (V5 TWAB architecture)

## Context

ADR-0001/0010 specify a **calendar-anchored, no-drift** schedule: each vault has a fixed weekly UTC slot, and a skipped (zero-deposit) round **self-heals to the same calendar slot next week** — "if a round skips, the next one still opens at the same calendar slot." A floating/rolling cycle was explicitly rejected ("drift accumulates, harder to communicate, doesn't self-heal skips").

On 2026-06-16, while investigating why V4.1-A and V4.1-B were both "Open" simultaneously, on-chain inspection of the live `TicketPrizePoolV4` contract found:

```solidity
function _openRound(uint256 rid) internal {
    ...
    r.salesEndTime = uint64(block.timestamp + roundDurationSec);  // always now + 24h
}

function _skipRound(uint256 rid) internal {
    ...
    r.state = RoundState.Settled;
    r.wasSkipped = true;
    if (rid == currentRoundId) _startNextRound();  // opens next round immediately, for another 24h
}
```

**There is no calendar anchor anywhere in the contract.** Every settle or skip opens the next round for `now + roundDurationSec` (24h). A skipped (empty) round does **not** wait for "the same slot next week" — it rolls the schedule forward by only 24h, drifting it ~6 days relative to what a calendar-anchored design would do.

This is exactly the "floating cycle, drift accumulates" design ADR-0001 rejected — but it's what's actually deployed.

## Scope

This logic (`_openRound` / `_skipRound` / `_startNextRound`) is shared bytecode across **all four live mainnet vaults**: V4-A, V4-B, V4.1-A, V4.1-B. None of them implement calendar-anchored scheduling.

**This is not a V4 regression — it was inherited verbatim from V2.** `TicketPrizePoolShmonV2.sol` has the identical `salesEndTime = block.timestamp + roundDurationSec` rolling arithmetic. The true root cause is a **false claim in ADR-0004** ("V2 contract behavior verified," 2026-05-03), which asserted the skip path "confirms ADR-0001's fixed schedule self-heals skips" — without checking `_openRound`'s timestamp arithmetic against ADR-0001's actual calendar-anchor requirement. Every later parity check (V4 launch ADR-0032, V4.1 ADR-0035, `tasks/feature-parity-checklist.md` row 60) verified V4 *against ADR-0004's description of V2*, not against ADR-0001/0010 directly or against V2's bytecode — so the false claim propagated unchallenged. It was never empirically exercised on V2's Vault A (38+ rounds, real deposits every week, skip path never triggered) until V4.1-B hit empty rounds in June 2026. **ADR-0004 has been corrected (2026-06-16) to retract the claim.**

**Observed evidence (2026-06-16):**
- V4.1-A round 1 had real deposits (2 tickets) → ran the full open+lock+draw cycle, round 2 opened ~6 days after round 1's sales ended. *Looks* compliant only because it had deposits.
- V4.1-B rounds 1–4 were all empty (`totalTickets=0`, `wasSkipped=true`) and each rolled forward by exactly ~24h — 4 rounds burned in 4 days, with no "wait for next week's slot" behavior at all.

## Decision

1. **Not fixable in V4/V4.1.** `roundDurationSec`, `_openRound`, and `_skipRound` are immutable bytecode already live with user funds (V4.1-A holds 1.274 shMON). Per ADR-0010, the only remediation for a cadence defect is redeploy — not warranted here pre-V5.
2. **Accepted as a known, documented defect in V4/V4.1** for the remainder of their operational life. The practical impact is limited to vaults/periods with zero deposits (a vault with steady deposits runs its full ~7-day open+lock+draw cycle every time, since `_skipRound` only fires when `totalTickets == 0`).
3. **Mandatory gate for V5 (ADR-0036):** the TWAB/DrawManager design **must** use fixed-length, calendar-anchored consecutive periods (`periodEnd = periodStart + N*drawPeriod` from a fixed genesis, independent of whether any given period had TWAB/deposits) — i.e., a zero-TWAB period that's "skipped" per ADR-0036 §3.4 must still consume exactly one `drawPeriod` slot, never collapse/roll the schedule. This must be explicitly verified (unit test: simulate N consecutive zero-TWAB periods, assert `periodStart`/`periodEnd` advance by exactly `N * drawPeriod` with no compounding drift) before V5 mainnet launch. Add to the M8 launch-gate checklist.

## Consequences

- V4.1-B's "weekly slot" framing in any user-facing copy should not claim calendar fixedness — it doesn't have any. Avoid promising specific weekday/time slots for V4.1 vaults in docs/marketing.
- V5 launch is blocked (per ADR-0036 gates) until the fixed-period invariant above is verified on the V5 contracts.

## Related ADRs

- ADR-0001, ADR-0010 — the violated invariant
- ADR-0032 — V4 launch record (where this should have been caught)
- ADR-0036 — V5 TWAB architecture (where the fix is mandatory)
