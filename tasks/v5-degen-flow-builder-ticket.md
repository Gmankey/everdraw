# Builder ticket — Degen pool deposit/withdraw flow (UI + backend)

**Date:** 2026-07-01. **From:** PM. **Implements:** ADR-0040 (Degen door). **Contracts already built:** #167 (`boostDeposit`/`boostWithdraw`/`BoostDeposit`/`BoostWithdraw`/`BOOSTER_DELEGATE`).

## Blocker first
The current UAT vault is a pre-#167 build — the note "this deployed vault does not expose the Degen pool contract methods yet" is exactly that. **Redeploy the UAT V5 vault from `staging` (post-#167)** so `boostDeposit`/`boostWithdraw` exist; the buttons stay dead until then. (Same isolated `everdraw-v5-uat` project; prod untouched.)

## Backend
- **Indexer:** index `BoostDeposit(booster, amount, balance, timestamp)` and `BoostWithdraw(...)`. Maintain per-wallet **degen balance**, **total degen TVL**, and a **history ledger** (deposit/withdraw rows).
- These feed: (a) the user's Degen balance in the UI, (b) **My History**, (c) the **points** system (Prize Patron bonus on first degen deposit; degen entries earn the 5× points multiplier — see the points ticket), (d) nothing on odds (degen = zero win chance, already enforced on-chain).
- No Merkl for EverDraw-side data — our own indexer.

## UI (on the Degen page, production styling)
- **Add to Degen pool / Withdraw** wired to `boostDeposit` / `boostWithdraw` (withdraw always available, no lock). **Withdrawal must show the context-aware confirmation modal** (full = resets your degen streak/multiplier; partial = removes your newest portion, the rest keeps its streak) — see the points ticket §5. Degen tenure/streak is independent of the vault's.
- On success: update **"Your Degen pool balance"**, add a **My History** row ("Degen deposit +X MON" / "Degen withdraw −X MON"), and the **main-page prize** projection ticks up/down (degen principal earns yield into the pot — see the prize ticket).
- Keep the card copy explicit: **adds to the prize, earns boosted points, no chance to win, withdraw anytime.**
- Show the user their degen points accruing (points ticket) — the incentive.

## Acceptance
- On the redeployed UAT vault: deposit/withdraw to the Degen pool works, balance + history update, the prize projection moves, degen points + Prize Patron fire. Prod untouched. Deliver as your own committed PR + UAT URL.
