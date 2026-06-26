# ADR-0040 — V5 Prize Booster door (retail yield-sponsorship), distinct from the sponsor primitive

**Status:** Proposed — awaiting operator confirmation, then builder re-review.
**Date:** 2026-06-26
**Deciders:** User (operator) + Claude (PM)
**Parent / context:** ADR-0036 (V5 TWAB architecture — sponsor primitive §3.1/§5.3/§5.4, fee flag §6a), ADR-0006 (Merkl-readable position surface), ADR-0008 (points), ADR-0039 (transferable share / honeypot lessons), ADR-0027 (fee router). Beta driver: "prize pot doesn't feel big enough yet."

## 1. Decision

Add a **second deposit door on the single V5 vault** (ADR-0041), `boostDeposit()`, for **retail/community "Prize Boosters"**: a depositor who **forgoes their own yield to grow the public prize**, keeps full principal claim, takes **zero win odds**, and is rewarded by an **externally-funded reward campaign** (primarily shMonad incentives) plus a capped, time-boxed EverDraw points multiplier.

This is **explicitly NOT the sponsor primitive** and must not be conflated with it:

| | **Sponsor** (ADR-0036 §5.4, unchanged) | **Booster** (this ADR, new) |
|---|---|---|
| Audience | partner / treasury / whale | retail / community |
| Entry | `sponsorDeposit()` | `boostDeposit()` (distinct) |
| Odds | zero | zero |
| Yield | → prize pool | → prize pool |
| Points / rewards | **zero** (deliberate, §248) | **rewarded** (partner tokens + capped points) |
| Event shape | deliberately **non-Merkl** | distinct **Merkl-readable** stream |
| Principal | withdrawable | withdrawable |

The sponsor stays exactly as designed (zero points, non-Merkl). The booster is the only thing that earns a payoff for giving up yield.

## 2. How the five systems interlock (required by the operator)

**TWAB.** `boostDeposit` custody is identical to a normal deposit, but the balance is TWAB-**delegated to a distinct `BOOSTER_DELEGATE` sink** (separate from the sponsor's zero-delegate). Both sinks are odds-excluded. Winner odds become:
`participantTWAB = totalPrincipalTWAB − sponsorDelegateTWAB − boosterDelegateTWAB`.
A separate `BOOSTER_DELEGATE` (rather than reusing the sponsor sink) is what lets us measure each booster's **time-weighted** contribution for rewards and keep booster yield distinguishable from sponsor yield in fee attribution. Same timing-attack immunity as everything else under TWAB: a last-second boost has ~zero weight.

**Vaults.** The booster is a **door on the single V5 PrizeVault** (ADR-0041), not a new contract. One pot. Normal deposits (odds) + sponsor yield + booster yield all feed the **same** prize → maximal pot, zero odds dilution for players.

**Merkl.** `boostDeposit`/`boostWithdraw` emit a **distinct Merkl-readable balance/timestamp event pair**, separate from both the ADR-0006 participant surface and the sponsor's non-Merkl events. An off-chain Merkl campaign computes each booster's **boost-seconds** and distributes the reward. Hard requirement: Merkl must **not** credit boost balances as odds-bearing participant points (boosters have zero odds) — booster rewards are their own campaign, never mixed with participant points.

**Points.** Boosters earn a **capped, time-boxed EverDraw points multiplier** (native, speculative) — *secondary*. Because we deliberately keep points' value ambiguous (ADR-0008; [[feedback_points_optionality_out_of_public_adrs]]), points are explicitly **not** the primary payoff. The **primary** payoff is partner-funded reward tokens (below). Sponsors still earn zero points — unchanged.

**Security.** See §3 — the boundaries that keep this no-loss and *not a security*.

## 3. Security & regulatory boundaries (binding)

1. **No-loss preserved.** Booster principal is always withdrawable (`boostWithdraw`), non-pausable like all withdrawals.
2. **Zero odds → not gambling.** Boosters are delegate-excluded and can never win. (This is *why* "Prize Booster," not "Degen" — the name must not undercut the zero-odds posture.)
3. **Reward is externally funded, never a revenue/fee share.** The booster reward is paid by a **partner campaign (shMonad incentives) and/or capped EverDraw points** — it is explicitly **NOT** a cut of EverDraw protocol fees or revenue. A revenue/fee-share to passive depositors is the Howey-test failure mode and is **prohibited** here without a separate legal review and ADR. This boundary is the whole point of writing this down.
4. **Booster position is non-transferable in V1.** No transferable receipt token → no honeypot / transfer-TWAB attack surface (the exact class ADR-0039 dealt with). A transferable booster receipt (for composability, e.g. Curvance) is **V2**, gated on its own security + Merkl re-confirmation review.
5. **Partner reward tokens** follow ADR-0036 §5.4/§7.5 acceptance rules (allowlisted; no fee-on-transfer / rebasing / hooks / ERC-777).
6. **Fee treatment** of booster yield is set by the existing §6a `feeBase` flag. Default recommendation: **booster yield is 100%-to-pot, fee-exempt** (`PARTICIPANT_YIELD_ONLY` basis) to maximize the prize — confirm at launch.

## 4. Phasing

- **V1 (rides V5.0):** `boostDeposit`/`boostWithdraw` + `BOOSTER_DELEGATE` accounting + distinct Merkl event + capped points multiplier + partner-funded reward campaign. UI label: **"Prize Booster."** Non-transferable.
- **V2:** optional transferable booster receipt token for composability — own ADR + security/Merkl review. Possibly a native "boost → multiplier on your *future* odds" loyalty mechanic (caveat: dilutes future players' odds at redemption — needs disclosure).

## 5. External dependencies (working rule 5)

- **shMON yield** — the booster's contribution source; if yield is zero/negative, boost contributes nothing (degrades gracefully — pot just doesn't grow).
- **shMonad reward funding (Alex campaign)** — the *primary* payoff. If not secured, V1 degrades to points-only, which we've assessed as a weak conversion driver — so **the Alex ask is a launch dependency, not a nice-to-have.** Frame to Alex as funding an official shMON growth channel (capped/time-boxed), not a perk.
- **Merkl** — must index the new boost event stream and run the booster reward campaign; re-confirm event shape against Merkl before launch (same discipline as ADR-0006/0039).

## 6. Rejected

- **Revenue / protocol-fee share to boosters** (the literal Megapot LP-fee model) — securities risk; also tiny on beta fee base. Prohibited (§3.3).
- **Reusing `sponsorDeposit` for boosters** — can't attribute rewards without conflating with the deliberately-zero-points sponsor; breaks §248.
- **Transferable receipt in V1** — reintroduces the ADR-0039 honeypot/transfer-TWAB surface; deferred to V2.
- **"Degen" branding** — discards the clean zero-odds / not-gambling posture for no upside.
