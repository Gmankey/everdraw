# Builder Ticket: Disable "Keep Playing" until Phase 2 (TWAB)

**Date:** 2026-05-08
**PM:** Claude
**Priority:** Pre-launch blocker
**Scope:** Frontend only

## Context

The "KEEP PLAYING" option in `ClaimFlowModal` is broken on V2 pools and cannot be cheaply made to work correctly. A proper rebuild is a continuous-deposits problem (TWAB) and will land in Phase 2.

The bugs:

1. `handleRedeposit`'s V2 path calls `buyTicketsMON` after a `withdrawPrincipal`. Withdraw returns shMON shares; the buy demands raw MON. The just-withdrawn principal is not actually reused.
2. The flow checks `salesOpen` of the currently-viewed pool only, not across both V2 pools. It cannot route to the other vault when this one is closed.
3. With 24h deposit windows offset by 3.5 days, ~60 hours per week neither vault is open, so the button does nothing useful for a large slice of the schedule.
4. Race condition: a user clicks ~20s before deposit window close, withdraw confirms, buy reverts on `SalesEnded`, user is left mid-flow holding shMON with no position.

A correct rebuild needs cross-pool target resolution, a `buyTicketsShmon` path with approval, leftover-shares handling, post-success UI navigation, and a "no open vault" disabled state. Out of scope for Phase 1.

## Decision

Disable the button entirely on V2 pools. Ship the proper rebuild with TWAB in Phase 2, where continuous deposits make the whole concept simpler (no windows to hit, no cross-vault routing).

## Scope

### `web/src/App.jsx`

In `ClaimFlowModal`, remove the `KEEP PLAYING` option from the `options` array for both winner and principal modes (currently around lines 327 and 349). Two options remain in each mode: claim/withdraw, and withdraw-and-convert.

Do not delete `handleRedeposit` or its wiring on the parent component yet. The V1 contract (`0xed67…`) is still running its current round and will retire around 2026-05-12. Keeping the function in place avoids a broader refactor right before launch. Once V1 is retired and removed from `VITE_POOL_ADDRESSES_V2`, the dead code can be cleaned up in a separate housekeeping pass.

### Verification

- Open the ClaimFlowModal in V2 winner mode and V2 principal mode. Confirm only two options render.
- Confirm winner-mode and principal-mode flows for claim, withdraw, and withdraw-and-convert all still work.
- No copy or layout regressions in the modal.

## Out of scope

- Building the correct V2 keep-playing flow (deferred to Phase 2 / TWAB).
- Removing `handleRedeposit` and related state from the codebase (do this when V1 retires).
- Marketing copy changes (already removed from `docs/getting-started/claiming-withdrawing.md` and `docs/how-it-works/round-lifecycle.md`).
