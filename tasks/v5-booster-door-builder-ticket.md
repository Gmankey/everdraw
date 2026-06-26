# Builder ticket — V5.0 Prize Booster door (`boostDeposit`)

**Date:** 2026-06-27. **From:** PM. **For:** Builder. **Implements:** ADR-0040 (Accepted design). **Rides:** V5.0 (ADR-0036 D2). **Related:** ADR-0041 (single vault), ADR-0006 (Merkl), ADR-0008 (points), ADR-0039 (transfer/honeypot lessons).
**Scheduling:** queued behind V5 core completion — TWAB is verified (#152/#155, testnet soak), keeper reliability is still open (`tasks/v5-keeper-reliability-builder-ticket.md`). Build the booster as part of the V5.0 substrate; do not start a separate vault.

## Scope
A second deposit door on the **single** V5 PrizeVault for retail "Prize Boosters": forgo your own yield to grow the public prize, keep principal, **zero win odds**, rewarded in **points only** (dual EverDraw + shMonad multiplier — no funded tokens, no revenue share). Distinct from the existing `sponsorDeposit` primitive — do **not** reuse it.

## Build

1. **Vault entry points** (`PrizeVaultV5`):
   - `boostDeposit()` (payable / shMON-direct, mirror `deposit`/`sponsorDeposit` custody) → credits a new `boosterPrincipalOf` ledger, increments `totalPrincipal`, routes the balance to the **booster delegate** (below). NOT into `principalOf` (no odds) and NOT into `sponsorPrincipalOf`.
   - `boostWithdraw(uint256)` → returns principal; **non-pausable** like all withdrawals (no-loss).
   - Booster position is **non-transferable** (Phase 1): no `transfer`/receipt for booster balances.

2. **TWAB exclusion** (`EverdrawTwabController`):
   - Add a distinct `BOOSTER_DELEGATE` sink (separate constant from `SPONSOR_DELEGATE`). Booster balances delegate to it → odds-excluded.
   - Winner odds denominator becomes `totalPrincipalTWAB − sponsorDelegateTWAB − boosterDelegateTWAB`. Confirm the draw/winner path (DrawManagerV5 §4 winner set + `startDraw` totalTwab read) subtracts **both** sinks.
   - Expose `getDelegateTwabBetween(vault, BOOSTER_DELEGATE, start, end)` for time-weighted booster measurement.

3. **Merkl event surface** (distinct from ADR-0006 participant surface and from the sponsor's deliberately-non-Merkl events, ADR-0036 §248):
   - Emit a dedicated `BoostDeposit`/`BoostWithdraw` (balance + timestamp) stream so an off-chain Merkl campaign can compute **boost-seconds** per address.
   - Hard requirement: this stream must **never** be read as odds-bearing participant points. Booster points are their own campaign.

4. **Fee:** booster yield takes **no protocol fee → 100% to the pot.** Wire via the §6a `feeBase` flag (`PARTICIPANT_YIELD_ONLY` basis, or fee=0 on the booster leg). Booster yield still flows into the prize exactly like sponsor yield, just fee-exempt.

## Tests (gate)
- Boost deposit: `boosterPrincipalOf` set, `principalOf` untouched, odds-excluded — a boost-only address has **zero** win probability across a draw.
- Odds denominator subtracts both sponsor and booster delegate TWAB; a normal participant's odds are unchanged by any amount of boosting (no dilution).
- Time-weighting: a late-period boost contributes ~zero boost-seconds for that period (mirror `test_transferAtPeriodBoundary…`).
- No-loss: `boostWithdraw` returns full principal even when the vault is paused.
- Fee: booster yield contributes to the prize with **zero** fee skim.
- Non-transferability: booster balance has no transfer path (Phase 1).
- Merkl event shape emitted and distinct; differential/unit coverage as per the M1 gate discipline. Update the gate-evidence doc.

## Out of scope (Phase 2 / separate)
- Transferable booster receipt token + Curvance composability (own ADR + security/Merkl review).
- "Boost → future-odds multiplier" loyalty mechanic.
- The shMonad points-multiplier campaign itself (partner/BD + Merkl config, not contract work) — see `tasks/alex-shmonad-booster-points-ask.md`.

## External dependencies (working rule 5)
- **Merkl** indexes the new boost event stream (re-confirm shape pre-launch).
- **shMonad points multiplier** (Alex ask) — the second farm; feature stands on EverDraw points alone if declined, but weaker.
- **shMON yield** — booster contribution source; zero/negative yield = pot just doesn't grow (graceful).
