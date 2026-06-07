# ADR-0034 — V5 Architecture Requirements: Flexible Yield, Decoupled Rewards, Rebasing, Mass Winner Distribution

**Status:** Proposed (draft — captures operator-surfaced requirements for V5; not yet accepted).
**Date:** 2026-06 (drafted during a feature-scrutiny session)
**Parent:** ADR-0024 (V4 spec), ADR-0030 (future-proofing inventory).

## Context

A scrutiny pass over V4's "generic asset support" surfaced three hard architectural limits that block EverDraw's stated product vision. Each is recorded here as a **V5 requirement with a proposed solution**, because V4 cannot do any of them and they were nearly lost as casual "yes it can" answers.

V4's prize model is fixed: deposit asset → staked into **one external ERC-4626 vault** → prize is the **share-price appreciation** of that vault → winners receive **shares** (not the underlying), which they redeem themselves. Three things break against that model.

---

## R1 — Flexible yield sources (not just appreciating ERC-4626 shares)

**Problem.** V4 requires the yield venue to be a single, transferable ERC-4626 token whose price captures **100%** of the yield. Real venues often fail this:
- A lending market (e.g. **Curvance**) may issue a non-transferable position/receipt rather than a fungible 4626 share — V4 has nothing to `transfer` to winners, so it can't use it at all.
- Yield frequently arrives partly as **separate reward-token emissions**, which V4 cannot see (it measures only share-price appreciation). That yield is silently lost.

**Proposed solution — yield-strategy adapter.** Abstract the yield venue behind an `IYieldStrategy` interface (mirroring how V4 abstracted randomness behind `IRandomnessOracle`):

```
interface IYieldStrategy {
    function deposit(uint256 assets) external returns (...);   // venue-specific
    function withdraw(uint256 assets, address to) external;    // venue-specific
    function totalAssets() external view returns (uint256);    // current underlying value held
    function claimAndCompound() external;                      // pull reward tokens, convert to asset
}
```

- EverDraw measures yield as a **value delta** (`totalAssets()` now vs. principal), not a share-count difference. This decouples it from the ERC-4626 share assumption.
- Each venue (Curvance, a lending market, an LP) gets a per-venue adapter that handles its specific deposit/withdraw mechanics and **compounds reward tokens internally** so all yield is captured in `totalAssets()`.
- Winners receive the **underlying asset** (or a strategy-issued claim), not necessarily venue shares.

This is the same proven pattern as the V4 oracle abstraction: EverDraw stays generic; the venue-specific complexity lives in a swappable adapter.

---

## R2 — Decoupled reward asset (protocol-token prize campaigns) — **the vision blocker**

**Problem.** V4's prize is **always the deposit asset's own yield**. So "deposit MON/USDC, win the PROTOCOL's token" is impossible — sponsors can only add more of the deposit asset. This **directly contradicts EverDraw's "prize layer for protocols" thesis**: a protocol wants users to deposit something neutral (MON/USDC) and be rewarded in the *protocol's own token* to drive distribution and adoption. Requiring users to deposit the protocol's token to win the protocol's token is circular and useless. **V4 cannot deliver the for-protocols vision.**

**Proposed solution — separate reward pool, independent of the deposit asset.**

- **Principal leg (unchanged, no-loss):** users deposit MON/USDC; it earns base yield via the R1 strategy; principal is always returned.
- **Reward leg (new):** a protocol pre-funds a **reward pool in any token** (its own token). The draw selects winners; winners receive from the reward pool **in addition to (or instead of) the base yield.**
- Deposit asset and prize asset are fully decoupled. No-loss is preserved because principal is tracked separately and never touches the reward pool.
- This is the on-chain core of the long-promised **CampaignManager**: a protocol funds a branded campaign in its token with one transfer; EverDraw runs the draw and distribution.

Design questions to resolve in the V5 spec: reward distribution shape (per winner position vs. pro-rata), whether base yield + reward stack or the reward replaces yield, refund of unspent reward on under-subscribed rounds, and reward-token transfer-failure resilience (reuse ADR-0028's deferred-claim pattern).

---

## R3 — Rebasing-token support

**Problem.** V4's share-count accounting only captures yield delivered as **rising share price with a fixed share count** (shMON-style). A **rebasing** source delivers yield by growing `balanceOf` while price stays ~1:1 → V4 sees **zero yield** and the rebased gains sit stranded. The exact-amount deposit check (`received == amount`) can also misbehave with rebasing balances.

**Proposed solution.** Solved by R1's **value-based accounting**: measuring `totalAssets()` (held value) at deposit and settle captures rebasing naturally, because it measures value rather than shares. So R1 and R3 converge on the same design — the yield-strategy adapter with a value measure handles appreciating-share *and* rebasing sources. No separate mechanism needed beyond R1.

---

## R4 — Large-scale winner distribution (>32 winners)

**Problem.** V4 caps winners at `MAX_WINNERS = 32`, because each winner costs ~25k gas of storage writes at settlement and an O(n) iteration at claim — N discrete on-chain prize transfers don't scale. But a protocol running a community campaign may legitimately want to reward **hundreds or thousands** of winners (e.g. "1,000 community members win a share of the pool"). V4 cannot do this, and simply raising the constant doesn't fix it — it just moves the gas cliff.

**Proposed solution — merkle-claim distribution mode.** For high winner counts, don't pay N transfers at settlement. Instead:
- The draw / off-chain process computes the winner set and per-winner amounts.
- The contract stores only a **merkle root** of `(winner, amount)` leaves at settlement — O(1) settlement gas regardless of winner count.
- Winners **claim against the root** (`claim(amount, proof)`), each paying their own claim gas. Unclaimed funds follow the same no-expiry / deferred semantics as today.

This scales to arbitrary winner counts at constant settlement cost, and is the right primitive past ~32 (the small-N path stays as-is for jackpot/tiered vaults; merkle mode is opt-in for mass-distribution vaults).

**Pairs with R2.** "Many winners of a partner token" is the canonical mass-reward campaign — it needs *both* the decoupled reward asset (R2) *and* merkle distribution (R4). They should be specced together as the **campaign / CampaignManager** feature set: a protocol funds a reward pool in its token (R2), the draw selects a large winner set, and winners claim via merkle (R4). Note that with a verifiable on-chain random seed, the winner-set computation must be reproducible/auditable off-chain so the merkle root can't be gamed by whoever builds it — a design detail to pin in the V5 spec.

**Decision needed:** keep the existing ≤32 discrete-transfer path for jackpot/tiered vaults, and add merkle mode as a separate vault mode for mass distribution — rather than forcing all vaults through merkle (which adds a claim step even for a single winner). Confirm in the V5 spec.

---

## R5 — Sponsor / reward funding models (V4 has exactly one; partners need several)

> **Operator directive (hard requirement):** ALL of 5a–5d below MUST work in V5 — they are must-haves, not candidates. Sponsorship in V4 is effectively single-purpose and does not serve real partner needs; V5 is not acceptable unless every sponsor model functions. Root cause acknowledged: the V4 sponsor design (ADR-0026) shipped only "drop-in donation" and deferred the rest without surfacing that this left most partner sponsorship scenarios unsupported.

**Problem.** V4 has a single sponsor model — `sponsor()` deposits the full contribution into the yield vault, adds **all** the resulting shares (principal + yield) to the prize, pays winners in **yield-vault shares**, and is **non-refundable** except on a fully-skipped round (`claimSponsorRefund` requires `wasSkipped`). The sponsor keeps nothing and cannot redeem principal on a settled round. Every realistic partner sponsorship pattern other than "donate the vault's asset, staked" is unsupported:

| Model | Sponsor intent | V4 |
|---|---|---|
| **5a — Reward-token donation** | Drop in a *different* token (e.g. the protocol's own token); winners receive that token; sponsor accepts non-refundability | ❌ sponsor must use the vault asset (same wall as R2) |
| **5b — Direct (unstaked) reward** | Add a reward in the *vault's* asset paid to winners **as the raw asset**, not converted to yield-vault shares | ❌ V4 always stakes; winners get shares, not the raw token |
| **5c — Principal-retaining, yield-only, recurring** | **Keep** the sponsored principal, donate only the **yield** it earns, and **auto-roll** the principal to sponsor subsequent rounds without manual redeem/redeposit | ❌ V4 donates everything; no principal retention, no recurrence (ADR-0026 deferred the "stake-yield sponsor" half to V4.1; auto-roll is new) |
| **5d — Sponsor principal redemption** | Redeem the retained principal | ❌ only meaningful once 5c exists; today a sponsor can never redeem on a settled round |

**Proposed solution.** A **sponsor-mode** parameter per sponsorship (or per campaign), spanning:
- **Asset:** vault asset *or* an arbitrary reward token (shares the R2 reward-pool mechanism).
- **Custody:** staked (current) *or* held raw and paid directly (5b).
- **Lifecycle:** one-shot donation (current) *or* principal-retaining with yield-only contribution and **auto-roll** to the next N rounds, with an explicit `redeemSponsorPrincipal()` (5c/5d). Principal-retaining sponsors are tracked separately from depositor principal and from one-shot `sponsoredPrize`, with their own refund/redeem accounting.

Recurrence (5c auto-roll) is the operationally important one: a partner funds a multi-week campaign once and the contract re-enters their principal each round automatically — no weekly manual transaction. This is core to the CampaignManager UX.

**Pairs with R2/R4:** 5a is the sponsor-side of the decoupled reward asset (R2); a reward-token, many-winner campaign is 5a + R4 (merkle) + R2. These should be specced as one coherent **campaign funding** model rather than four bolt-ons.

---

## Why these are V5, not a V4 patch

R1–R5 are accounting and prize-flow redesigns, not additive functions. They change how yield is measured, how prizes are funded, and how sponsors retain/redeem capital — the core of the contract. They cannot be bolted onto the deployed V4 vaults; they define the next contract generation. (The immediate V4.x shMON-deposit fix, ADR-pending, is separate and small.)

## Consequences / sequencing

- These should anchor the **V5 spec** when it's scoped. R2 is the highest-value (it unblocks the entire for-protocols revenue narrative); R1+R3 unblock non-MON and non-4626 assets.
- Until V5, be explicit with partners: EverDraw **cannot** pay a different/partner token as the prize, and **cannot** use yield venues that aren't transferable, fully-price-accruing ERC-4626 vaults (so most lending/LP venues need a custom auto-compounding wrapper, or aren't supported).
- The `IYieldStrategy` adapter pattern (R1/R3) and the decoupled reward pool (R2) are independent workstreams and can be specced separately.

## Open questions

- **R2:** does the protocol-token reward fully replace the base yield, or stack on top? (Stacking is more attractive but doubles the accounting surface.)
- **R1:** do winners receive the underlying asset (strategy redeems on their behalf) or a strategy claim token? Redeeming on-behalf adds an external call to the settle/claim path — weigh against ADR-0028 resilience.
- **R2:** multiple reward tokens per campaign, or one? Multi-token multiplies distribution + deferred-claim surface.
- Is there partner demand strong enough to pull V5 forward, or does V4.x (shMON deposit + parity fixes) hold the line first?
