# ADR-0041 — Collapse to a single vault (retire the two-vault model for the product)

**Status:** Proposed — awaiting operator confirmation.
**Date:** 2026-06-26
**Deciders:** User (operator) + Claude (PM)
**Supersedes (product direction):** ADR-0010 (Vault A/B cadence invariant) and ADR-0003 (Vault B deployment) for the live product. ADR-0036 D1 already retired the two-vault stagger for V5. Related: ADR-0040 (Booster door lives on the one vault), ADR-0037 (cadence).

## 1. Decision

**One vault, one pot.** Beta users report the A/B two-vault UX is confusing, and two vaults **split prize liquidity** (each pot only grows on its own slice of TVL+yield). Consolidating to a single vault means **every depositor — normal, sponsor, and booster — feeds the same prize**, maximizing pot size, which is the core beta acquisition/retention lever.

This converges with V5, which is **single continuous vault by design** (ADR-0036 D1). So this ADR is less a new mechanism than making "single vault" the canonical product UX and sequencing the live V4.1 wind-down to get there without violating no-loss or stranding a prize.

## 2. Live V4.1 plan (interim, before V5)

State at 2026-06-26 (mainnet): **V4.1-A** `0x933F…` round 3, ~7.46 MON, not paused; **V4.1-B** `0x1886…` round 9, ~8.23 MON, not paused. Neither has a stranded prize.

**Retire V4.1-A, keep V4.1-B as the single visible beta vault.** A is the newer, slightly smaller, less-established vault (round 3 vs 9). Sequence (no-loss-safe):

1. **Stop new deposits into A** and **remove A from the frontend `VITE_POOL_ADDRESSES` and the indexer `POOL_ADDRESSES`** — except a clearly-surfaced **withdraw path**.
2. **Let A's current round complete and pay its prize** (do not pause mid-lock and hide — that would strand the in-flight prize and confuse A's depositors). Pausing, if used, must keep **withdrawals live** (V4.1 design; verified) — principal is never trapped.
3. **No forced A→B migration.** V4.1 cannot move funds between vaults; users would withdraw+redeposit. Forcing A→B now and then B→V5 later = **double migration churn**. Instead: A stops taking new money, new deposits go to B, and the **real consolidation happens at the V5 single-vault cutover** (one migration, not two).
4. Result during beta: **one visible vault (B)**, A in withdraw-only wind-down.

## 3. V5 (the real single-vault)

V5 ships as one continuous PrizeVault with three doors on the **same pot**:
- **Normal deposit** — odds, base points (ADR-0006/0008 participant surface).
- **Sponsor deposit** — zero odds, zero points (ADR-0036 §5.4).
- **Boost deposit** — zero odds, partner-funded reward + capped points (ADR-0040).

All yield (participant + sponsor + booster) funds the single prize → maximal pot, no odds dilution. This is the operator's "one pot, everyone grows the prize" vision in full.

## 4. Security / no-loss invariants

- Retiring a vault must **never trap principal.** A's withdrawals stay live throughout.
- **Never strand an in-flight prize** — let A's round draw/pay before hiding it fully.
- Indexer/frontend pool-config changes go through the canonical reconciliation control (backlog P0-1) so A's removal can't silently re-drift, and B is never accidentally dropped.

## 5. External dependencies (working rule 5)

- **Frontend (Vercel `VITE_POOL_ADDRESSES`)** and **indexer (`POOL_ADDRESSES`)** must both drop A and keep B — verify on the live surface (working rule 6), not just in config.
- **User comms** — A's depositors must be told to withdraw (and that principal is safe). Without comms, hiding A from the UI while funds remain is a support/trust problem.

## 6. Rejected

- **Pause-and-hide A immediately** — risks stranding A's in-flight prize and orphaning depositors who can't see their position; only acceptable once A's round has paid out and withdraw remains surfaced.
- **Force A→B migration now** — double churn before the V5 cutover; not worth it for beta TVL.
- **Keep two vaults** — splits prize liquidity and confuses users; contradicts the V5 single-vault design.
