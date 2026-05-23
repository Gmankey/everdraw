# ADR-0012 — Reentrancy trust model for `_buyTicketsMON`

**Status:** Accepted
**Date:** 2026-05-20
**Deciders:** User + Claude

## Context

Slither flags `_buyTicketsMON` (both V1 and V2Compat) as `reentrancy-eth` because state writes to `r.totalShmonShares`, `r.totalTickets`, and `r.ranges` occur after the external call `shmon.deposit{value: cost}(cost, address(this))`. This violates the Checks-Effects-Interactions (CEI) pattern.

## Decision

**We accept the CEI violation and rely on two complementary safeguards:**

1. **`nonReentrant` modifier** is already applied to `_buyTicketsMON`. This prevents any reentrant call from completing regardless of what `shmon` does.
2. **`shmon` is the Monad LST** — the canonical, protocol-level staking contract. It is trusted infrastructure, not a user-supplied address.

The CEI violation is not fixable while maintaining the current design: `r.totalShmonShares += shares` must follow the call because `shares` is the return value of `shmon.deposit`. A full CEI refactor would require a view-call-first pattern that introduces gas waste and share-rate race conditions, adding complexity for no practical benefit.

## Why full CEI is not pursued

- `shares` is unknowable before the call.
- Storing a pending intent and reconciling post-call would significantly increase contract complexity and introduce new state-consistency edge cases.
- The `nonReentrant` guard already prevents exploitation if any assumption about `shmon` is ever violated.

## Prize cap dependency

This trust assumption is sound at current TVL and prize sizes. If EverDraw ever supports an upgradeable or swappable `shmon` address (i.e. `shmon` becomes user-configurable), this ADR must be revisited and a reentrancy audit must precede deployment.

## Consequences

- No code change required.
- Any future refactor that makes `shmon` configurable must add a reentrancy audit gate.
- If Monad introduces a new LST contract as a breaking upgrade, the new address must be vetted before swapping in production.

## Related ADRs

- ADR-0011 — Vault B contract replacement
