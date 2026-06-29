# ADR-0040 — V5 Prize Booster door (retail yield-sponsorship), distinct from the sponsor primitive

**Status:** Accepted (design) — operator confirmed 2026-06-27: payoff = dual points (EverDraw + shMonad), **no** fee on booster yield (100%-to-pot), transferable receipt deferred to Phase 2. Builder ticket to follow. shMonad points-multiplier: **Alex agreed in principle 2026-06-30; multiplier value TBD** (§5).
**Date:** 2026-06-26 (amended 2026-06-27)
**Deciders:** User (operator) + Claude (PM)
**Parent / context:** ADR-0036 (V5 TWAB architecture — sponsor primitive §3.1/§5.3/§5.4, fee flag §6a), ADR-0006 (Merkl-readable position surface), ADR-0008 (points), ADR-0039 (transferable share / honeypot lessons), ADR-0027 (fee router). Beta driver: "prize pot doesn't feel big enough yet."

## 1. Decision

Add a **second deposit door on the single V5 vault** (ADR-0041), `boostDeposit()`, for **retail/community "Prize Boosters"**: a depositor who **forgoes their own yield to grow the public prize**, keeps full principal claim, takes **zero win odds**, and is rewarded by a **dual points multiplier — boosted EverDraw points + boosted shMonad points** (the latter via a shMonad campaign ask).

**Honest framing of the payoff (corrected):** the reward is *points, not funded tokens*. Both EverDraw points and shMonad points have **no confirmed value** today. That still drives behavior — shMonad's own degen pool runs on exactly this basis (give up yield to farm ambiguous-value points on airdrop expectation). The booster's edge is **stacking two point systems at once** (double-farming EverDraw + shMonad), more compelling than either alone. We make **no value promise** on either ([[feedback_points_optionality_out_of_public_adrs]]). Because the payoff is points (not a share of tokens/revenue), the regulatory surface is *lower* than a funded reward and far from the Howey line — see §3.

This is **explicitly NOT the sponsor primitive** and must not be conflated with it:

| | **Sponsor** (ADR-0036 §5.4, unchanged) | **Booster** (this ADR, new) |
|---|---|---|
| Audience | partner / treasury / whale | retail / community |
| Entry | `sponsorDeposit()` | `boostDeposit()` (distinct) |
| Odds | zero | zero |
| Yield | → prize pool | → prize pool |
| Reward | **zero** (deliberate, §248) | **boosted EverDraw + shMonad points** (no confirmed value) |
| Event shape | deliberately **non-Merkl** | distinct **Merkl-readable** stream |
| Principal | withdrawable | withdrawable |

The sponsor stays exactly as designed (zero points, non-Merkl). The booster is the only thing that earns a payoff for giving up yield.

## 2. How the five systems interlock (required by the operator)

**TWAB.** `boostDeposit` custody is identical to a normal deposit, but the balance is TWAB-**delegated to a distinct `BOOSTER_DELEGATE` sink** (separate from the sponsor's zero-delegate). Both sinks are odds-excluded. Winner odds become:
`participantTWAB = totalPrincipalTWAB − sponsorDelegateTWAB − boosterDelegateTWAB`.
A separate `BOOSTER_DELEGATE` (rather than reusing the sponsor sink) is what lets us measure each booster's **time-weighted** contribution for rewards and keep booster yield distinguishable from sponsor yield in fee attribution. Same timing-attack immunity as everything else under TWAB: a last-second boost has ~zero weight.

**Vaults.** The booster is a **door on the single V5 PrizeVault** (ADR-0041), not a new contract. One pot. Normal deposits (odds) + sponsor yield + booster yield all feed the **same** prize → maximal pot, zero odds dilution for players.

**Merkl.** `boostDeposit`/`boostWithdraw` emit a **distinct Merkl-readable balance/timestamp event pair**, separate from both the ADR-0006 participant surface and the sponsor's non-Merkl events. An off-chain Merkl campaign computes each booster's **boost-seconds** and distributes the reward. Hard requirement: Merkl must **not** credit boost balances as odds-bearing participant points (boosters have zero odds) — booster rewards are their own campaign, never mixed with participant points.

**Points.** The payoff *is* points — a **dual multiplier**: boosted **EverDraw points** (native) + boosted **shMonad points** (via the shMonad campaign ask). Both are explicitly **no-confirmed-value** and we promise nothing (ADR-0008; [[feedback_points_optionality_out_of_public_adrs]]). The draw is the *stack* (two farms at once) plus the prize-altruism, mirroring shMonad's degen pool. Sponsors still earn zero points — unchanged.

**Security.** See §3 — the boundaries that keep this no-loss and *not a security*.

## 3. Security & regulatory boundaries (binding)

1. **No-loss preserved.** Booster principal is always withdrawable (`boostWithdraw`), non-pausable like all withdrawals.
2. **Zero odds → not gambling.** Boosters are delegate-excluded and can never win. (This is *why* "Prize Booster," not "Degen" — the name must not undercut the zero-odds posture.)
3. **Reward is points only, never a revenue/fee share.** The booster reward is **EverDraw + shMonad points** (no confirmed value) — explicitly **NOT** a cut of EverDraw protocol fees, revenue, or any token entitlement. A revenue/fee-share to passive depositors is the Howey-test failure mode and is **prohibited** here without a separate legal review and ADR. Points-for-yield is the same posture shMonad's degen pool already operates under; revenue-share is not.
4. **Booster position is non-transferable at launch (Phase 1).** No transferable receipt token → no honeypot / transfer-TWAB attack surface (the exact class ADR-0039 dealt with). A transferable booster receipt (for composability, e.g. Curvance) is **Phase 2**, gated on its own security + Merkl re-confirmation review.
5. **Booster yield takes NO protocol fee → 100% to the pot** (operator decision, 2026-06-26). Set via the §6a `feeBase` flag (`PARTICIPANT_YIELD_ONLY` basis, or fee=0). Conscious trade: EverDraw earns no revenue on booster yield — that's intended; the goal is maximal pot, not fee income.

## 4. Phasing

> Terminology: there is **one protocol — V5.** "Phase 1 / Phase 2" below are *booster-feature* phases inside V5 (mapping to ADR-0036 D2's V5.0 / V5.1), **not** separate protocol versions. (Earlier drafts said "V1/V2" — that collided with V4.1/V5 and is renamed here.)

- **Phase 1 — ships with V5.0:** `boostDeposit`/`boostWithdraw` + `BOOSTER_DELEGATE` accounting + distinct Merkl event + dual points multiplier (EverDraw + shMonad). UI label: **"Prize Booster."** Non-transferable.
- **Phase 2 — V5.1+:** optional transferable booster receipt token for composability (e.g. Curvance) — own ADR + security/Merkl review. Possibly a native "boost → multiplier on your *future* odds" loyalty mechanic (caveat: dilutes future players' odds at redemption — needs disclosure).

## 5. External dependencies (working rule 5)

- **shMON yield** — the booster's contribution source; if yield is zero/negative, boost contributes nothing (degrades gracefully — pot just doesn't grow).
- **shMonad points multiplier (Alex ask)** — the second farm in the stack. **Status (2026-06-30): Alex/shMonad has AGREED in principle to the booster points multiplier; the exact multiplier value is still TBD.** So this external dependency is largely de-risked — only the number remains (feeds the cap/window decision here and the Merkl campaign config). This was a lightweight ask (a points multiplier costs shMonad nothing real, same as their own degen pool). If the number ends up low it's still additive; the feature also stands on EverDraw points alone.
- **Merkl** — must index the new boost event stream and run the booster points campaign; re-confirm event shape against Merkl before launch (same discipline as ADR-0006/0039).

## 6. Rejected

- **Revenue / protocol-fee share to boosters** (the literal Megapot LP-fee model) — securities risk; also tiny on beta fee base. Prohibited (§3.3).
- **Funded reward *tokens* as the payoff** (prior draft) — rejected as both unnecessary and a bigger ask; the payoff is points (EverDraw + shMonad), matching the model retail already engages with on shMonad's degen pool.
- **Reusing `sponsorDeposit` for boosters** — can't attribute points without conflating with the deliberately-zero-points sponsor; breaks §248.
- **Transferable receipt at launch (Phase 1)** — reintroduces the ADR-0039 honeypot/transfer-TWAB surface; deferred to Phase 2.
- **"Degen" branding** — discards the clean zero-odds / not-gambling posture for no upside.
