# ADR-0043: V5 prize auto-compound

**Status:** Accepted 2026-07-06 (PM call, operator-delegated). **Auto-compound by default, opt-out to MON. In V5 launch scope, sequenced LAST** — after the streak-checkpoint fix and the points-page reconciliation — folded into the ADR-0042 scoped review, followed by a full UAT re-soak. **Gas: keeper pays (socialized)** — deducting from prizes would corrupt merkle-leaf amounts for dust-level savings. Rationale for accepting despite the cost: the `immutable` wiring makes this a full migration if done post-mainnet; pre-mainnet is the cheapest moment this change will ever have.

## Context
When a V5 draw finalizes, the prize is escrowed in ClaimManagerV5 and the winner must actively claim (to wallet, or manually restake). Unclaimed prizes sit idle in escrow: no entries, no yield to the pot, no points, dead capital, and a per-draw chore for winners.

Proposal: **auto-compound by default** — the prize is automatically credited to the winner's vault principal (a new tranche at tenure 0, §2b-consistent), resuming normal deposit behavior (TWAB entries, yield to pot, points). Winners can **opt out** to receive MON to their wallet.

## What the change actually requires (verified against src/v5 on staging)

| # | Component | Change | Why (verified) |
|---|-----------|--------|----------------|
| 1 | **PrizeVaultV5** | New `depositFor(address recipient)` payable (credits recipient, not msg.sender) + distinct event or flag marking it a prize-compound | `deposit()` credits `msg.sender` only — ClaimManager cannot deposit on the winner's behalf today |
| 2 | **ClaimManagerV5** | New compound path: on claim/finalize, `vault.depositFor{value}(winner)` instead of `_tryPay(winner)`; plus an **opt-out registry** (mapping + setter + event) | `_claim` pays `leaf.account` directly via `_tryPay`; no redirect exists |
| 3 | **DrawManagerV5** | **Forced redeploy with no logic change** | `claimManager` is `immutable` in DrawManagerV5 — new CM ⇒ new DM |
| 4 | **Vault wiring** | `vault.setDrawManager(newDM)` — a **timelocked** operation under ADR-0042 hardening | DM redeploy cascades here |
| 5 | **Keeper** | Trigger compounds at finalize (or piggyback claimMany); handle failures (paused vault → fall back to escrow/deferred) | Someone must execute the default; winners won't |
| 6 | **Indexer** | Ingest the compound as a Deposit-equivalent → opens tranche at tenure 0. Minimal if `depositFor` emits the standard `Deposit(recipient, amount)` + a marker event for UI labeling | Points/tranche correctness (§2b) |
| 7 | **Frontend** | Opt-out toggle, "you won — prize was restaked" notification/history labeling, claim UI retained for opt-outs + legacy escrow | Winners must know they won |

## Costs

- **Builder effort:** contracts + tests ~3–5 days; keeper + indexer + frontend ~2–3 days; total ≈ **1–1.5 weeks** of builder time.
- **Redeploy churn:** new ClaimManager + DrawManager on UAT ⇒ re-point keeper, indexer (re-backfill), frontend env; **full UAT re-validation cycle** (the stack just stabilized 2026-07-05/06).
- **Audit surface:** couples ClaimManager⇄Vault (new external call path, reentrancy surface, paused-vault edge). Expands exactly the scope ADR-0042 flagged for scoped review. Any external review budget grows.
- **Ongoing keeper gas:** one deposit (~150–250k gas) per winner per draw — trivial on Monad at current fees, but it's a new permanent keeper duty + failure mode.
- **Timeline competition:** displaces the streak-checkpoint bug fix, #190 points-page reconciliation, and launch-readiness items if done first.

## Impacts

- **Economics:** proportionality is preserved — compounding a prize is identical to the winner depositing it, so odds stay proportional to balances; no distortion. Effects: TVL retention up, escrow idle capital → productive, pot yield slightly up. Winners' balances grow faster than cash-takers' (by construction; optics only).
- **UX:** removes the per-draw claim chore (the actual problem). Requires clear "you won N MON — restaked" surfacing or winners may never realize they won.
- **Tax/consumer optics:** auto-reinvestment of winnings by default; prize is still a receipt. Opt-out is the mitigation — must be easy to find.
- **Risk cases to spec in the ticket:** vault paused at compound time (fall back to escrow, winner claims later); winner opted out mid-cycle; reentrancy CM→Vault (nonReentrant both ends); contract-wallet winners.

## Why decide before mainnet
The `immutable` wiring means doing this **after** mainnet launch is a full contract **migration** (redeploy + user comms + liquidity move). Pre-mainnet it is "just" a testnet redeploy. This is the cheapest moment this change will ever be.

## Alternatives
- **B — No contract change:** keeper auto-claims prizes **to wallets** (mechanism exists) + one-click "restake" in the claim UI. Prizes never sit idle, but they don't compound by default. ~1–2 days total, zero contract/audit cost.
- **C — Status quo:** claim-only; idle escrow persists. Rejected as the problem statement.

## Recommendation (PM)
Adopt auto-compound **in V5 launch scope, sequenced last**: (1) streak-checkpoint bug + #190 reconciliation first (days, no contracts), (2) then this as the final pre-launch contract change, folded into the ADR-0042 scoped review, followed by one full UAT re-soak. If the launch date can't absorb ~1.5 weeks + re-soak, ship Alternative B at launch and do auto-compound as V5.1 — accepting that it becomes a migration.

## External dependencies
ClaimManagerV5 (escrow→vault path), PrizeVaultV5 (`depositFor`), DrawManagerV5 (redeploy, immutable wiring), keeper (execution + gas), Pyth (unchanged), indexer (Deposit-equivalent ingestion), shMonad (deposit path unchanged — compound enters as native MON via existing strategy deposit). Failure of keeper ⇒ prizes remain safely escrowed and claimable (must be the designed fallback, not an error state).
