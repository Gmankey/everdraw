# V5 Design Handoff to Builder

**Status:** Design ownership transferred from PM (Claude) to the builder agent. The PM is demoted to read-only review after repeated design and operational failures (recorded in Part 4). The builder owns V5 design from here.

**Date:** 2026-06-08

**How to read this:** Part 1 is the full V5 scope as discussed. Part 2 is the dependency map and the single most important structural realization. Part 3 is the open design questions you must resolve. Part 4 is an honest record of where the PM got the design wrong or missed things — treat those as the areas to scrutinize hardest, because the PM's judgment there was demonstrably unreliable. Part 5 is the V4.1 baseline you build from.

Source records: ADR-0034 (R0–R6, partial), ADR-0006 (Merkl surface), ADR-0007 (TWAB deferral), ADR-0024 (V4 spec + V5 deferred list), ADR-0025 (multi-winner), ADR-0026 (sponsors), ADR-0027 (fee router), ADR-0028 (deferred claims), ADR-0029 (oracle abstraction), ADR-0031 (multisig deferred to V5), `docs-site/pages/vision/phase-2.md`, the Nitro pitch (`tasks/everdraw-nitro-pitch.md`, `tasks/nitro-application-answers*.md`).

---

## Part 1 — V5 scope (full)

### R0 (FOUNDATIONAL) — Continuous deposits / Time-Weighted Average Balance (TWAB)

This is the core model change. Everything else is expressed on top of it.

**Public promise (vision/phase-2.md, not optional):**
- Users deposit continuously — no rounds, no sales windows, no ticket purchases.
- The protocol tracks each wallet's **time-weighted average balance** over a draw period. `P(win) = your TWAB / total pool TWAB`.
- "Deposit Tuesday, withdraw Friday — you earn chances for every day your MON was in the vault."
- Timing attacks become impossible (a last-second deposit has negligible time-weighted average).
- Draws run more frequently (e.g. daily) instead of weekly.
- **Automatic prize distribution**: an incentivised keeper network pushes prizes to winners; winners do not claim manually.

**What it deletes from V4:** the entire `Open → AwaitingVRF → Drawn → Settled` round lifecycle, the 1-day sales window + ~6-day yield period, ticket purchases, and the ticket-range data structure used for both ownership and winner selection.

**What it newly requires (V4 deliberately does NOT have these):**
- **On-chain time-weighted balance accounting** — per-account and pool-level, updated on every deposit/withdraw (observation/checkpoint ring buffers, cf. Uniswap V3 oracle / PoolTogether V4 TWAB). ADR-0006 explicitly punted time-weighting to Merkl off-chain for Phase 1; V5 must bring it on-chain because prize odds now depend on it. **This is the central new engineering of V5.**
- **A new winner-selection mechanism** — V4 rejection-samples over ticket ranges (ADR-0025). Under TWAB there are no tickets; selection samples the random draw across the time-weighted balance distribution. Multi-winner and mass distribution (R4) must be redesigned against TWAB weights.
- **A draw scheduler decoupled from deposits** — draws run on a cadence over the continuous pool, independent of any individual's deposit timing.

**Hard collisions (this is why R0 is foundational, not additive):**
- **Payout model vs the deferred-claim substrate (ADR-0028).** phase-2.md promises automatic *push* distribution. The V4 substrate is *pull*-based deferred claims. They conflict, and the conflict sharpens under R4 (hundreds/thousands of winners — you cannot naively push thousands of transfers). Resolution direction: auto-push for small winner counts, merkle-pull for mass; whichever runs must preserve the ADR-0028 guarantee (one failing payout never blocks others, nothing is lost) and stay non-pausable/non-stoppable so winnings can't be trapped.
- **"Ticket price" dissolves.** The V4 mutable ticket price and its per-round snapshot have no meaning under continuous deposits.
- **Sponsors / fees / reward asset (R2/R5/R6)** must be re-expressed against continuous draw periods, not discrete rounds.

**What survives:** ADR-0006's Merkl surface (Deposit/Withdraw events, off-chain time-weighting for points) is compatible — keep emitting those events with the same shape.

### CampaignManager — the "for protocols" half of Phase 2

phase-2.md ships TWAB **and** the CampaignManager together. The PM never specced this as its own feature; it was only implied through R2/R4/R5. It needs first-class design:
- `createCampaign(prizeToken, budget, drawFrequency, eligibility)` — a protocol runs a branded prize campaign with a single treasury transfer. No contract changes on the protocol's side, no audit, no yield source required.
- **Eligibility** verified on-chain via **token snapshots or Merkle allowlists** (not captured anywhere in ADR-0034 — design from scratch).
- EverDraw handles draw execution, winner selection, claim/distribution, frontend integration; the protocol keeps its branding and user relationship.
- This is the B2B2C revenue thesis. It composes R2 (decoupled reward token) + R4 (mass distribution) + R5 (funding models) + eligibility.

### R1 — Flexible yield sources

V4 requires a single transferable ERC-4626 whose share price captures 100% of yield. Real venues break this: lending markets (e.g. Curvance) may issue non-transferable position receipts (nothing to transfer to winners); yield often arrives partly as separate reward-token emissions V4 cannot see. **Proposed:** an `IYieldStrategy` adapter (mirroring V4's `IRandomnessOracle` abstraction) with value-based `totalAssets` accounting so yield is measured as a value delta, not share-price appreciation.

### R2 — Decoupled reward asset (protocol-token prizes) — "the vision blocker"

V4's prize is always the deposit asset's yield. Partners want to award **their own token** as the prize, funded from a separate reward pool — independent of deposit-asset yield. This is the single highest-value V5 requirement (it unblocks the entire for-protocols narrative) and V4 cannot express it at all.

### R3 — Rebasing tokens

V4 measures yield as share-count appreciation, which misses rebasing yield entirely. Solved by R1's value-based accounting (measure value delta, store proportions not fixed amounts).

### R4 — Mass winner distribution (>32 winners)

V4 caps winners at 32 (per-winner storage + O(n) settlement). Community campaigns may want hundreds/thousands of winners. **Proposed:** a merkle-claim distribution mode — store only a merkle root of `(winner, amount)` at settlement (O(1) settlement gas), winners claim against it. The winner-set computation from the on-chain random seed must be **reproducible/auditable off-chain** so the root can't be gamed by whoever builds it. Keep the ≤32 discrete-transfer path for jackpot/tiered vaults; merkle mode is opt-in for mass distribution.

### R5 — Sponsor / funding models (ALL FOUR are hard must-haves — operator directive)

V4 sponsors can only "donate everything" (principal + yield, non-refundable except on a fully-skipped round). Real partner needs, none of which V4 supports:
- **5a** — sponsor rewards in a **different token** than deposits (needs R2's reward-pool mechanism).
- **5b** — sponsor rewards in the **same token but unstaked** (a direct reward, not staked into yield).
- **5c** — sponsor **retains principal**, donates only the **yield** it earns, and **auto-rolls** to fund subsequent draws without manual re-deposit (the operationally important one — fund a multi-week campaign once).
- **5d** — sponsor can **redeem their retained principal** (only meaningful once 5c exists; today a sponsor can never redeem on a settled round).

**Proposed:** a sponsor-mode parameter spanning asset (deposit vs reward token), custody (staked vs raw/direct), and lifecycle (one-shot vs principal-retaining-recurring with explicit redeem). Track principal-retaining sponsors separately from depositor principal and one-shot donations.

### R6 — Fee-model flexibility

V4's fee is hardwired to "bps of the deposit-asset's yield shares, on the whole prize." Required:
- **6a** — configurable fee base: all yield (participant + sponsored) vs participant-yield-only (sponsored exempt).
- **6b** — fee derived from the value delta under R1/R3 accounting, not a share count.
- **6c** — fee-token handling when yield/rewards are a different token (R1/R2): in that token, in the deposit asset, or multi-token.

The fee router's recipient/split/cap/snapshot logic (ADR-0027) carries over; its payout path does NOT (see cross-cutting).

### Cross-cutting — generalize the deferred-claim payout substrate (ADR-0028)

The single payout path every winner/fee/sponsor/principal disbursement flows through assumes "a fixed number of shares of the one yieldVault ERC-20, moved by one `transfer`, stored on failure as a fixed `uint256` per (round, recipient, slot)." **Every V5 workstream breaks that assumption** (R1 redeem-not-transfer; R2/R6c different token; R3 fixed-amount drifts under rebasing; R4 32-slot cap + a second pull mechanism; R5b raw/unstaked). It must be re-generalized to: per-slot `(token, amount-or-proportion)`; a payout abstraction that can move a raw ERC-20, redeem through a yield strategy, or settle a merkle claim — each with the same defer-on-failure guarantee; a single unified pull-claim path shared with R4; and a larger/replaced slot namespace. **Preserve the guarantee; rebuild the implementation. Spec this first as the substrate the others build on.**

### Other promised-but-uncaptured features (the PM missed all of these in ADR-0034)
- **MegaDraw** — cross-vault orchestrator (ADR-0024 lists it; not designed).
- **Permissionless factory** — protocol-self-serve vault deployment (ADR-0024 names it for V5; not designed). Note: PoolTogether V5 has this — study why partners still found it hard (ERC-4626 / liquidation-pair / TWAB / bot-economics complexity) and whether the CampaignManager's "single treasury transfer, no yield source needed" path is the better primitive.
- **Automatic keeper distribution** — the incentivised keeper network that pushes prizes (phase-2.md); ties into R0 payout + R4.
- **Campaign eligibility** — token snapshots / Merkle allowlists (part of CampaignManager).
- **Multisig governance** — ADR-0031 deferred owner→multisig migration to V5.

---

## Part 2 — Dependency map and the key realization

**Build order (suggested):**
1. **R0 (TWAB core)** + the **generalized payout substrate** (cross-cutting) — the foundation. Nothing else is correct until the core loop and payout path are defined.
2. **R1/R3** (value-based yield accounting via `IYieldStrategy`) — unblocks non-MON / non-4626 / rebasing.
3. **R2** (decoupled reward asset) — highest product value; unblocks protocol-token prizes.
4. **CampaignManager** = R2 + R4 (merkle mass distribution) + R5 (funding models) + eligibility — the for-protocols product.
5. **R6** (fee flexibility) — folds into the R1/R2 accounting.
6. **MegaDraw, factory, multisig** — later, on top.

**The single most important structural realization the PM under-weighted:** **R0 (continuous TWAB) likely obsoletes the entire two-vault staggered-cadence model.** The 3.5-day stagger (ADR-0010), the cadence guard, two vaults, and round states all exist to spread *round-based* draws across the week. Continuous deposits with frequent (daily) draws make the stagger meaningless. A large amount of V4 machinery (cadence guard, dual-vault deployment, round lifecycle, ticket ranges, mutable ticket price) may simply not carry forward. The builder should decide early whether V5 is **continuous-only** (simplest, matches the public promise, retires the round model) or **dual-mode** (round-based + continuous coexisting), because that decision reshapes everything downstream.

---

## Part 3 — Open design questions the builder must resolve

1. **TWAB scope:** replace the round model outright (continuous-only) or run round-based and continuous as two modes? (phase-2.md promises continuous; continuous-only is the simplest coherent V5.)
2. **Stagger/cadence:** does the two-vault 3.5-day stagger survive at all under continuous draws, or is it retired?
3. **Payout:** the auto-push vs merkle-pull threshold for winner count; how to preserve the ADR-0028 guarantee and non-pausable/non-stoppable exits under both.
4. **Reward token (R2):** does the protocol-token reward **replace** base yield or **stack** on top? (Stacking is more attractive but doubles the accounting surface.)
5. **Winner asset (R1):** do winners receive the underlying (strategy redeems on their behalf — adds an external call to the payout path, stressing ADR-0028 resilience) or a strategy claim token?
6. **Reward tokens per campaign:** one or many? (Multi-token multiplies distribution + deferred-claim surface.)
7. **Eligibility:** snapshot vs Merkle allowlist mechanism for campaigns; gas + freshness tradeoffs.
8. **Factory:** how permissionless deployment interacts with the TWAB core, eligibility, and any remaining cadence; what's locked vs configurable.
9. **Governance:** when owner→multisig migration lands (ADR-0031) relative to V5 launch.

---

## Part 4 — Record of PM (Claude) design and execution failures

This section exists because the operator no longer trusts the PM's design judgment, with cause. These are the concrete failures from this engagement. Treat the related design areas as untrusted and re-derive them.

**Design failures / things not considered:**
1. **TWAB omitted from the V5 requirements entirely.** The single biggest, publicly-promised V5 feature (phase-2.md, deferred in ADR-0007, named in ADR-0024) was left out of ADR-0034 until the operator asked about it directly. The PM wrote a "V5 requirements" ADR that missed the foundational requirement.
2. **shMON deposit gap.** V4 accepted only MON. V3 had stubbed an shMON path with no ADR; the PM inherited that gap into V4 without flagging it, AND wrote user/developer docs falsely stating shMON deposits worked. This forced the entire V4.1 redeploy.
3. **"Generic asset support" oversold.** The PM initially claimed V4 could run USDC-lending-yield / Curvance-style vaults. It cannot — non-transferable lending positions and reward-token emissions break V4's share-appreciation model. Capability was overstated until the operator pushed back.
4. **Sponsorship shipped single-purpose.** V4 sponsors can only donate-everything; four real partner sponsor models (5a–5d) are unsupported, and the PM deferred them in ADR-0026 without surfacing that this left most sponsorship scenarios broken.
5. **Fee model and deferred-claim coupling missed.** The PM initially stated the fee router's deferred-claim machinery "carries over unchanged" to V5. Wrong — every V5 workstream breaks the single-token payout assumption. Corrected only on re-examination.
6. **Multi-winner cap not proactively considered.** The 32-winner cap and the need for a >32 path (R4) were only raised after the operator asked.
7. **CampaignManager / eligibility / MegaDraw / factory** — all promised in the vision/pitch, none captured in the V5 requirements until the operator forced a reconciliation. ADR-0034 was presented as more complete than it was.
8. **Cadence stagger "safeguard" was theatre.** The original V4-B was deployed ~55 minutes from V4-A, violating the 3.5-day stagger (ADR-0010). The PM had written a "safeguard" as prose in an ADR, then nearly repeated the same bug, and only built a real machine-enforced deploy guard after the operator pointed out that a document is not a safeguard.
9. **"No demand, defer shMON" misjudgment.** The PM recommended freezing V4 and deferring shMON deposit based on an incorrect read that there was no demand — when shMON was in fact expected to be the largest launch asset (Merkl/shMonad building points for it). Reversed only after correction.
10. **Fabricated an option that was never discussed.** The PM offered "shMON-only" as a deposit-mode choice; it had never once been considered. Inventing options the operator never raised.
11. **Proposed a plan contradicting an existing invariant.** Early on, the PM proposed "one coordinated redeploy" of both vaults — which directly contradicts the 3.5-day stagger (deploy time = anchor, so the vaults must be deployed 3.5 days apart).
12. **Process failures:** reactive one-at-a-time gap discovery instead of comprehensive reconciliation (the operator had to repeatedly ask "what else are you missing?"); misattributing a claim to the operator ("you said the developer docs were fine" — the operator had not said that); relying on memory/summaries instead of checking ADRs.

**Operational failure (highlighted at the operator's request):**
13. **Lost ~2.41 MON of operator funds during the V4.1-A deploy cleanup.** The deployer-key sweep transaction failed (gas buffer too small), but the cleanup script used `cast send … && echo ok`, which masked the failure from `set -e`, so the script proceeded to `shred` the deployer key **before the sweep had succeeded** — and combined the sweep and the key deletion into one script. The sweep was trivially retryable with a larger gas buffer, but the key was already destroyed, stranding 2.41 MON unrecoverably. A rookie scripting error with a direct financial cost. The durable safety rule now in place: never delete a key until the sweep tx is confirmed and the balance is read back as ~0 on-chain; never combine sweep + deletion in one script or `&&` chain; leave a real gas buffer (~0.1 MON).

**Implication for the builder:** the PM's "it can do X" claims about V4, and its V5 requirement lists, were repeatedly incomplete or wrong. Re-derive V5 design from the source ADRs and the vision docs directly. Where this document and the PM's prior statements conflict with the contract source or the vision docs, trust the source and the vision docs.

---

## Part 5 — V4.1 baseline (what you build from)

Current production contract: `TicketPrizePoolV4` (VERSION 4.1.0), live on Monad mainnet (chainId 143). Round-based, ticket model. Capabilities:
- **Deposits:** native MON (staked to shMON via `yieldVault.deposit`) and, as of V4.1, **direct shMON** (`buyTicketsShmon` — pulls shMON via `transferFrom`, `previewDeposit`-priced, no re-staking). ERC-20 deposit mode also exists.
- **Yield/prize:** single external ERC-4626 (shMON in production); prize = share-price appreciation; winners receive shares (redeem themselves).
- **Winners:** 1–32, rejection-sampling over ticket ranges (ADR-0025); forfeit-to-depositors when tickets < winner positions.
- **Sponsors:** donate-everything only (ADR-0026), refundable only on a fully-skipped round.
- **Fees:** multi-recipient router, ≤8 recipients, ≤20% total, per-round snapshot, paid in yield shares (ADR-0027); currently 0%.
- **Payout resilience:** `_transferOrDefer` deferred-claim layer, pull-based, single yieldVault share token (ADR-0028).
- **Admin:** owner (Ledger), separate pauser role (halts deposits + progression, never claims/withdrawals), one-way `stop()` retirement, mutable ticket price (±10×/call, per-round snapshot), randomness via `IRandomnessOracle` (Pyth Entropy adapter, 24h change timelock, ADR-0029).
- **Cadence:** two vaults, 3.5-day stagger (ADR-0010), now machine-enforced by the deploy script's stagger guard.
- **Indexing:** Merkl-readable non-transferable position surface (ADR-0006).
- New V4.1 views: `getWithdrawableShares`, `getRoundTicketPrice`.

Live addresses are in `deployments/monad-mainnet.json` (V4.1-A: `0x933FF608eaC2b3221088bd9AE19b05F266dBF7DA`).

---

*Prepared by the demoted PM as a complete, honest handoff. The builder owns V5 design.*
