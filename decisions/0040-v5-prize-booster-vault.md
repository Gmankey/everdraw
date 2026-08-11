# ADR-0040 — V5 Patron Pool (retail yield-sponsorship), distinct from the sponsor primitive

**Status:** Accepted — beta launches with boosted EverDraw points; shMonad/Merkl campaign activation is deferred until after beta has users (operator, 2026-08-11). No fee on Patron yield (100%-to-pot); transferable receipt remains deferred to Phase 2.
**Date:** 2026-06-26 (amended 2026-06-27 and 2026-08-11)
**Deciders:** User (operator) + Claude (PM)
**Parent / context:** ADR-0036 (V5 TWAB architecture — sponsor primitive §3.1/§5.3/§5.4, fee flag §6a), ADR-0006 (Merkl-readable position surface), ADR-0008 (points), ADR-0039 (transferable share / honeypot lessons), ADR-0027 (fee router). Beta driver: "prize pot doesn't feel big enough yet."

## 1. Decision

Add a **second deposit door on the single V5 vault** (ADR-0041), `boostDeposit()`, exposed to users as the **Patron Pool**: a depositor who **forgoes their own yield to grow the public prize**, keeps full principal claim, takes **zero win odds**, and earns boosted EverDraw points.

**Beta launch amendment (2026-08-11):** Merkl/shMonad points are not a beta launch dependency.
Alex's team will consider campaign activation after EverDraw has users. The distinct event stream
remains available, but launch copy must promise only EverDraw points. No value promise is made for
either points system.

This is **explicitly NOT the sponsor primitive** and must not be conflated with it:

| | **Sponsor** (ADR-0036 §5.4, unchanged) | **Booster** (this ADR, new) |
|---|---|---|
| Audience | partner / treasury / whale | retail / community |
| Entry | `sponsorDeposit()` | `boostDeposit()` (distinct) |
| Odds | zero | zero |
| Yield | → prize pool | → prize pool |
| Reward | **zero** (deliberate, §248) | **boosted EverDraw points** at beta; shMonad campaign deferred |
| Event shape | deliberately **non-Merkl** | distinct **Merkl-readable** stream |
| Principal | withdrawable | withdrawable |

The sponsor stays exactly as designed (zero points, non-Merkl). The booster is the only thing that earns a payoff for giving up yield.

## 2. How the five systems interlock (required by the operator)

**TWAB.** `boostDeposit` custody is identical to a normal deposit, but the balance is TWAB-**delegated to a distinct `BOOSTER_DELEGATE` sink** (separate from the sponsor's zero-delegate). Both sinks are odds-excluded. Winner odds become:
`participantTWAB = totalPrincipalTWAB − sponsorDelegateTWAB − boosterDelegateTWAB`.
A separate `BOOSTER_DELEGATE` (rather than reusing the sponsor sink) is what lets us measure each booster's **time-weighted** contribution for rewards and keep booster yield distinguishable from sponsor yield in fee attribution. Same timing-attack immunity as everything else under TWAB: a last-second boost has ~zero weight.

**Vaults.** The booster is a **door on the single V5 PrizeVault** (ADR-0041), not a new contract. One pot. Normal deposits (odds) + sponsor yield + booster yield all feed the **same** prize → maximal pot, zero odds dilution for players.

**Merkl.** `boostDeposit`/`boostWithdraw` emit a distinct balance/timestamp event pair reserved
for a later campaign. Merkl activation is post-beta. If activated, Patron balances must remain
separate from odds-bearing participant points because Patrons have zero draw odds.


**Security.** See §3 — the boundaries that keep this no-loss and *not a security*.

## 3. Security & regulatory boundaries (binding)

1. **No-loss preserved.** Patron principal is always withdrawable (`boostWithdraw`), non-pausable like all withdrawals.
2. **Zero odds → not gambling.** Patrons are delegate-excluded and can never win.
3. **Reward is points only, never a revenue/fee share.** Beta reward is EverDraw points with no confirmed value, explicitly not a cut of protocol fees, revenue, or any token entitlement. A future shMonad campaign does not change this boundary.
4. **Booster position is non-transferable at launch (Phase 1).** No transferable receipt token → no honeypot / transfer-TWAB attack surface (the exact class ADR-0039 dealt with). A transferable booster receipt (for composability, e.g. Curvance) is **Phase 2**, gated on its own security + Merkl re-confirmation review.
5. **Booster yield takes NO protocol fee → 100% to the pot** (operator decision, 2026-06-26). Set via the §6a `feeBase` flag (`PARTICIPANT_YIELD_ONLY` basis, or fee=0). Conscious trade: EverDraw earns no revenue on booster yield — that's intended; the goal is maximal pot, not fee income.

## 4. Phasing

> Terminology: there is **one protocol — V5.** "Phase 1 / Phase 2" below are *booster-feature* phases inside V5 (mapping to ADR-0036 D2's V5.0 / V5.1), **not** separate protocol versions. (Earlier drafts said "V1/V2" — that collided with V4.1/V5 and is renamed here.)

- **Phase 1 — ships with V5.0 beta:** `boostDeposit`/`boostWithdraw` + `BOOSTER_DELEGATE` accounting + distinct future-campaign event stream + boosted EverDraw points. UI label: **"Patron Pool."** Non-transferable.
- **Phase 2 — V5.1+:** optional transferable booster receipt token for composability (e.g. Curvance) — own ADR + security/Merkl review. Possibly a native "boost → multiplier on your *future* odds" loyalty mechanic (caveat: dilutes future players' odds at redemption — needs disclosure).

## 5. External dependencies (working rule 5)

- **shMON yield** — the booster's contribution source; if yield is zero/negative, boost contributes nothing (degrades gracefully — pot just doesn't grow).
- **shMonad points multiplier (Alex ask)** — agreed in principle, but activation and the exact multiplier are deferred until EverDraw has beta users. This is not a beta launch gate.
- **Merkl** — post-beta campaign dependency. Re-confirm the Patron event shape before activating shMonad points, not before launching the EverDraw beta.

## 6. Rejected

- **Revenue / protocol-fee share to boosters** (the literal Megapot LP-fee model) — securities risk; also tiny on beta fee base. Prohibited (§3.3).
- **Funded reward *tokens* as the payoff** (prior draft) — rejected as both unnecessary and a bigger ask; the beta payoff is EverDraw points, with any shMonad campaign remaining optional and post-beta.
- **Reusing `sponsorDeposit` for boosters** — can't attribute points without conflating with the deliberately-zero-points sponsor; breaks §248.
- **Transferable receipt at launch (Phase 1)** — reintroduces the ADR-0039 honeypot/transfer-TWAB surface; deferred to Phase 2.
- **"Degen" branding** — discards the clean zero-odds / not-gambling posture for no upside.
