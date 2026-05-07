# ADR-0007 — Defer "Keep Playing" to Phase 2 (TWAB)

**Status:** Accepted
**Date:** 2026-05-08
**Deciders:** User + Claude (PM)

## Context

The `ClaimFlowModal` in the V2 frontend exposes a "KEEP PLAYING" option that promises to take the user's settled principal (and prize, if winner) and route it directly into the next open round in one flow. The intent is to remove friction for users who want to redeposit immediately.

On V2 the implementation is fundamentally broken because of architectural changes from V1:

1. `handleRedeposit`'s V2 branch calls `buyTicketsMON` after `withdrawPrincipal`. Withdraw returns shMON shares; `buyTicketsMON` is `payable` and demands raw MON via `msg.value`. The just-withdrawn principal does not actually fund the redeposit. The flow only "works" if the user has unrelated MON sitting in their wallet.
2. The flow checks `salesOpen` of the currently-viewed pool only, not across both V2 pools. With two vaults, it cannot route to the other vault when the viewed vault is closed.
3. Vault A and Vault B's deposit windows are 24h each, offset by 3.5 days. Roughly 60 hours per week neither vault is open. The button does nothing useful during those windows.
4. Race condition: a user clicks ~20s before a deposit window closes, the withdraw confirms, the buy reverts on `SalesEnded`, and the user is mid-flow holding shMON with no position.

A correct V2 rebuild requires:
- Cross-pool resolution to find the next open vault, not just the current view's vault.
- A `buyTicketsShmon` path with approval, so withdrawn shMON is what funds the buy.
- Handling of leftover shares when the share rate has moved between withdraw and redeposit.
- UI navigation to the destination vault on success.
- A "no open vault" disabled state with a countdown to the next window.

That is roughly a day of frontend work plus careful testing. It is the wrong shape of feature for Phase 1's discrete-window mechanics.

## Decision

**Disable the "KEEP PLAYING" button on V2 pools for Phase 1.** Ship the proper redeposit flow in Phase 2 alongside TWAB, where continuous deposits eliminate every one of the architectural problems above.

Specifically:

- The button is removed from `ClaimFlowModal` for both winner and principal modes on V2 pools.
- `handleRedeposit` itself stays in the codebase until the V1 contract retires (around 2026-05-12), since V1 still uses the function and works.
- After V1 retires, `handleRedeposit` and related wiring become dead code and are cleaned up in a separate housekeeping pass.
- Docs do not mention "Keep Playing" anywhere user-facing.

In Phase 1, users action a settled round in two clicks: withdraw their principal, then deposit fresh into whichever vault is open when they choose. This matches user mental models for round-based lotteries and avoids ghost states.

## Rationale

- Phase 1 is round-based with discrete deposit windows. Keep-playing is fighting the model. Phase 2 is continuous deposits via TWAB, where "redeposit" doesn't even need to be a separate concept.
- The V2 fix is non-trivial and the surface area for new bugs is real, this close to launch.
- Two clicks is a fine UX for the small number of users who will be active in Phase 1. Friction at the boundary is acceptable when the alternative is a half-broken feature.
- We are not abandoning the concept. It returns in Phase 2 in a form that actually works (no windows to hit, no cross-vault routing problem).

## Alternatives considered

- **Fix the button properly in Phase 1.** Rejected. Roughly a day of focused frontend work plus a careful test pass right before launch, with a non-trivial new surface for bugs. Wrong moment, wrong investment, especially given Phase 2 obsoletes the design anyway.
- **Leave the button visible but route to a clear "no open vault" message.** Rejected. The button still triggers a multi-tx flow with race-condition risk. Hiding the button is safer and clearer.
- **Hide the button with no replacement copy.** Accepted. The remaining two options (withdraw, withdraw-and-convert) are sufficient and don't need a third "redeposit" call-to-action in Phase 1. Users who want to redeposit click withdraw, then go to the open vault.

## Consequences

### Frontend
- `ClaimFlowModal` shows two options on V2 pools instead of three.
- `handleRedeposit` remains in place to support the still-running V1 contract until retirement.
- A follow-up housekeeping ticket (post V1 retirement) removes the dead code.

### Docs
- `docs/getting-started/claiming-withdrawing.md` and `docs/how-it-works/round-lifecycle.md` already have all "Keep Playing" references removed.
- No FAQ entry needed. The feature simply doesn't exist in Phase 1 and we don't promote what we don't ship.

### Phase 2 backlog
- Add "redeposit / continuous flow design" to the Phase 2 epic, scoped against TWAB.
- Decide at that point whether redeposit is even a discrete user-visible action, or whether continuous deposits make the question moot.

## Open questions

None.

## Related

- Builder ticket: `../tasks/disable-keep-playing-2026-05-08.md`
- Phase 2 vision: `../docs/vision/phase-2.md`
