# ADR-0036 — V5 Architecture: TWAB Core, Generalized Payouts, Flexible Yield & Sponsorship

**Status:** Proposed (full design; awaiting operator sign-off on the open decisions in §10, then builder review).
**Date:** 2026-06-10
**Parent:** ADR-0034 (V5 requirements R0–R6), `tasks/v5-design-handoff-to-builder.md` (scope + failure record), `docs-site/pages/vision/phase-2.md` (public promise).
**Supersedes on V5:** the round/ticket model of ADR-0024/0025, the two-vault stagger of ADR-0010, the sponsor model of ADR-0026, and the implementation (not the guarantee) of ADR-0028. ADR-0027 (fee router recipients/splits) and ADR-0029 (randomness abstraction) carry forward. ADR-0006's Merkl event surface carries forward unchanged.

This ADR is the design. The execution plan, milestones, and test plan live in `tasks/v5-build-plan.md`, which cites this ADR.

---

## 1. Operator decisions already locked (2026-06-10)

These four were confirmed explicitly by the operator and are not open for redesign without a new operator decision:

- **D1 — TWAB fully replaces the round model.** V5 is continuous-only. No rounds, no sales windows, no tickets, no two-vault stagger. V4.1 round vaults run in parallel until retired; the round machinery does not carry into V5.
- **D2 — Phased release.** **V5.0** = TWAB core + generalized payout substrate + flexible yield + fee flexibility + sponsor models (R0, R1, R3, R5b/5c/5d, R6, cross-cutting). **V5.1** = CampaignManager + eligibility + full campaign product (R2 orchestration, R4 at campaign scale, R5a productized). The V5.0 substrate MUST be multi-token and mass-winner capable from day one so V5.1 requires **no core redeploy** (see §6).
- **D3 — Fresh contracts; users self-migrate; V4.1-B still deploys at +3.5 days.** No contract-level migration function. The migration UX is two transactions (see §8). V4.1 A+B and Merkl points continue uninterrupted during the V5 build.
- **D4 — Winner selection: keeper-computed, on-chain-verifiable.** Winners are derived deterministically from the on-chain VRF seed + on-chain TWAB state by a published, versioned algorithm. The keeper posts a merkle root; anyone can recompute it; a challenge window precedes finalization. Not keeper-trusted, not fully-on-chain.

## 2. Design goals and non-goals

**Goals (in priority order):**
1. No-loss invariant: depositor principal is always withdrawable, under every failure mode, pause state, and retirement state. This outranks every feature.
2. The phase-2.md public promise: continuous deposits, TWAB odds, more frequent draws, automatic prize delivery.
3. A payout substrate that R1–R6 and the V5.1 CampaignManager all plug into without core changes.
4. Every external dependency enumerated with an explicit failure-mode answer (working rule #5).

**Non-goals for V5.0** (explicitly out, to protect the audit surface):
- CampaignManager contract, campaign eligibility (snapshots/allowlists), campaign branding/orchestration → V5.1.
- Permissionless factory, MegaDraw → post-V5.1 (but the TwabController singleton in §3 is designed so they don't require a TWAB redesign).
- Transferable deposit receipts (ERC-20/4626 share tokens for depositors) → positions stay non-transferable as in V4 (preserves the ADR-0006 Merkl surface, avoids TWAB-on-transfer complexity).
- TWAB delegation (PoolTogether-style "delegate my odds to another address") → deferred; the only delegation V5.0 ships is the sponsor's delegate-to-zero (§5.4).
- Bonded/fraud-proof challenge for winner roots → V5.0 ships guardian-veto (§4.4); bonded challenges are named future work.

## 3. Contract architecture

Five contracts plus one interface family. Separation criteria: (a) what must be shared across future vaults (TwabController), (b) what holds user principal (PrizeVault — smallest possible surface), (c) what is replaceable (strategies, oracle adapters).

```
                       ┌──────────────────┐
 users ── deposit ───▶ │   PrizeVaultV5   │──── deposit/withdraw ───▶ IYieldStrategy ──▶ shMON (4626)
        ◀─ withdraw ── │  (principal +    │                            (ShmonStrategy)
                       │   sponsor ledger)│
                       └───────┬──────────┘
                               │ balance change hooks
                               ▼
                       ┌──────────────────┐
                       │  TwabController  │  (singleton, shared by all future vaults)
                       └───────┬──────────┘
                               │ TWAB reads
                               ▼
 keeper ─ startDraw ─▶ ┌──────────────────┐──── requestRandomness ──▶ IRandomnessOracle ──▶ Pyth Entropy
 keeper ─ postRoot ──▶ │   DrawManager    │     (ADR-0029, reused)
                       └───────┬──────────┘
                               │ finalized draw (root, prize legs)
                               ▼
 winners ◀─ claims ─── ┌──────────────────┐ ◀── fundPrize(token, amt) ── sponsors (5a/5b)
 (keeper auto-executes)│   ClaimManager   │
                       └──────────────────┘
```

### 3.1 TwabController (singleton)

Standalone time-weighted average balance accounting, deliberately separated from the vault so that future vaults (factory, MegaDraw, V5.1 campaign pools) share one accounting source of truth.

- Per-account and per-vault-total **observation ring buffers**: packed `(cumulativeBalanceSeconds, timestamp, balance)` observations, appended on every balance change, binary-searched for period queries.
- Write access restricted to **registered vaults** (owner-registered; registration is append-only — a vault can never be unregistered while it has nonzero total balance).
- Read API: `getTwabBetween(vault, account, startTime, endTime)` and `getTotalTwabBetween(vault, startTime, endTime)`.
- `P(win) = account TWAB over the draw period / total TWAB over the draw period`. A last-second deposit has negligible average — timing attacks die by construction.
- **Strong recommendation: adapt PoolTogether V5's TwabController (MIT-licensed, repeatedly audited) rather than greenfield it.** This is the highest-complexity, highest-blast-radius new component. Adapting a battle-tested implementation converts the central engineering risk of V5 into a diligence task. The builder must still: re-verify against our exact usage, strip what we don't use (delegation), and carry it through our own audit. License attribution required. If the builder instead greenfields it, that is a deviation requiring an ADR update with rationale.

### 3.2 PrizeVaultV5 (holds principal — minimum possible surface)

- **Deposits:** native MON (wrapped into the strategy) and **direct shMON** (`depositShmon` — the V4.1 path carries forward; it is also the migration path, §8). Min-deposit threshold (anti-dust, §7.6), owner-tunable with an event; launch value 0 (Q3).
- **Total-deposit cap (launch-gating, per Q6):** owner-tunable `depositCap` on `totalPrincipal`; deposits revert above it, withdrawals are never affected by it. This is the explicit risk bound for running unaudited principal-holding code — raised stepwise as confidence builds, removable if an audit is later funded.
- **Withdrawals:** continuous, any time, no windows. **Never pausable, never stoppable** (V4 invariant carried forward). Withdrawal burns the account's balance (TwabController updated) and pays out via the strategy.
- **Principal ledger:** `principalOf[account]` and `totalPrincipal` in underlying-asset terms. The no-loss invariant is expressed against this ledger: the vault must always be able to cover `totalPrincipal` (see §7.1 for the shortfall case).
- **Emergency exit:** if `strategy.withdraw` fails, the depositor may instead call `emergencyRedeemShares()` to receive their pro-rata strategy shares directly (the V4 "winners get shares" escape hatch, generalized to principal). This is the answer to "the yield venue is paused/broken": users are never trapped behind a failing external call.
- **Sponsor deposits:** `sponsorDeposit()` — identical custody to a normal deposit, but the balance is **TWAB-delegated to the zero address**: it earns yield for the prize and has zero win odds. See §5.4.
- Positions are non-transferable. `Deposit`/`Withdraw` events keep the ADR-0006 shapes so Merkl points integration is untouched.

### 3.3 IYieldStrategy + ShmonStrategy (R1 + R3)

```solidity
interface IYieldStrategy {
    function deposit(uint256 assets) external payable returns (uint256);
    function depositShares(uint256 shares) external returns (uint256 assets); // direct shMON path
    function withdraw(uint256 assets, address to) external;
    function totalAssets() external view returns (uint256);  // current underlying VALUE held
    function claimAndCompound() external;                    // pull reward emissions, fold into totalAssets
    function transferShares(address to, uint256 shares) external returns (bool); // emergency exit only
}
```

- Yield is measured as a **value delta**: `totalAssets() - totalPrincipal - undistributedPrize`. This is what makes appreciating-share (shMON), rebasing (R3), and emission-paying (R1) venues all look the same to the core. The core never reasons about share prices.
- One strategy per vault, swappable behind the same **24h timelock pattern as ADR-0029's oracle swap** (queue → 24h → commit; swap mechanically migrates all assets old→new and reverts if the value received is below a tolerance). The timelock gives users a public exit window before any strategy change — same threat model as the oracle timelock.
- V5.0 ships `ShmonStrategy` only. Curvance/lending/LP adapters are post-launch, additive, and individually reviewed (a malicious or buggy strategy can steal everything it holds — strategy code review is a per-adapter audit obligation, named in §7.2).

### 3.4 DrawManager

- **Cadence:** draws cover consecutive periods `[periodStart, periodEnd)` of `drawPeriod` seconds (owner-tunable with timelock; launch value is an open decision, §10-Q1). No deposit windows — the period only bounds the TWAB measurement and the prize accrual.
- **Trigger is permissionless:** after `periodEnd`, anyone may call `startDraw()` (keeper does it in practice; keeper death does not stall the protocol). It snapshots the prize (§5.1), requests randomness via `IRandomnessOracle` (ADR-0029 contract reused as-is, including the 24h oracle-swap timelock and the per-consumer adapter deployment), and records the request.
- **Seed lands** via `onRandomnessReceived` exactly as in V4.
- **Root proposal:** once the seed is on-chain, the winner set is fully determined (§4). The keeper computes it and calls `proposeRoot(drawId, root, winnerCount, totalPayout)`. Liveness fallback: if no root is proposed within `proposerGracePeriod` (e.g. 12h), **anyone** may propose. `totalPayout` must equal the snapshotted prize legs exactly or the proposal reverts.
- **Challenge window → finalize:** see §4.4.
- A draw with zero total TWAB or zero prize is **skipped** cleanly (recorded, no VRF spend where avoidable, prize rolls to the next draw).

### 3.5 ClaimManager (the generalized ADR-0028 substrate)

The single payout path for every prize, fee, and reward disbursement. Principal does **not** flow through it (principal exits directly from PrizeVault; this keeps the highest-stakes path on the shortest code).

- **One mechanism for any winner count: merkle claims.** Leaves are `(drawId, account, token, amount)`. A draw with 1 winner and a draw with 10,000 winners use the same path — this removes the V4 32-winner cap (R4), the slot-namespace byte, and the push/pull split in one move.
- **"Automatic distribution" = the keeper executing claims on winners' behalf.** `claim(leaf, proof)` is permissionless and pays the leaf's account, never `msg.sender`. The keeper batch-executes all leaves after finalization (`claimMany`) — winners wake up paid, which is the phase-2.md promise — and any winner can always self-claim if the keeper is dead. Push and pull are the same code path.
- **Defer-on-failure, per leaf, preserved from ADR-0028:** if a leaf's token transfer reverts or returns false, record `pendingClaims[drawId][account] → (token, amount)` and continue; `claimDeferred` retries later. One failing payout never blocks any other, and nothing is ever lost. Deferred records are `(token, amount)` pairs — multi-token-correct (R2/R6c) — and **never expire**.
- **Non-pausable, non-stoppable.** Pause gates deposits and draw progression only; `stop()` (retirement) halts new deposits and new draws; claims and withdrawals work forever in both states. Carried verbatim from the V4 invariant (ADR-0028 / pauser review).
- Fee recipients are paid as ordinary leaves in the draw's tree (§5.3) — the fee inherits the same resilience instead of having its own transfer path (the V3 fee-freeze bug class is dead by construction).
- Amounts in leaves are **fixed token amounts settled at proposal time**. For the yield leg the proposal converts value → strategy-underlying amount at snapshot; rebasing drift between proposal and claim is bounded by the claim delay and absorbed by the dust buffer (§5.1). (Storing proportions instead was considered and rejected: it makes leaves non-verifiable against `totalPayout` and complicates the challenge check.)

## 4. Winner selection (D4): deterministic, reproducible, challengeable

### 4.1 The canonical algorithm

A versioned, published specification (`docs-site/pages/developers/draw-algorithm.md`) + a reference implementation (`scripts/draw/compute-winners.ts`). Given only on-chain data, it is fully deterministic:

**Inputs:** the VRF seed for the draw; the draw period `[start, end)`; the TwabController observation history (reconstructable from events or read from state); the draw's prize legs and tier configuration.
**Account set:** every address with a nonzero TWAB over the period, enumerated in a canonical order (ascending address) from `Deposit`/`Withdraw`/`SponsorDeposit` events. Sponsor-delegated balances are excluded by construction (their TWAB is zero).
**Selection:** K winners sampled **with replacement**, weighted by TWAB, by walking a deterministic PRF stream `keccak(seed, i)` over the cumulative-TWAB line (binary search per sample). With-replacement means a large depositor can win multiple positions — same economics as holding many V4 tickets, and it keeps the algorithm trivially verifiable. Per-position amounts come from the tier table.
**Output:** the leaf set and merkle root. Two independent implementations must agree (differential testing is a release gate — see build plan).

### 4.2 Why off-chain compute is sound here

The chain cannot enumerate accounts or iterate TWAB history affordably, but it can verify a commitment. Everything the algorithm consumes is on-chain and immutable once the seed lands, so the root is a pure function — "keeper-computed" is a gas optimization, not a trust grant, **provided** the challenge window is real (§4.4).

### 4.3 Liveness

`startDraw` permissionless; root proposal permissionless after a grace period; claims permissionless. The keeper is an optimization at every step, a single point of failure at none. (Root-proposal griefing — spamming bad roots to exhaust guardian attention — is rate-limited: one active proposal per draw; a vetoed proposal reopens proposing after a cooldown. A proposer bond is named as an option in §10-Q5.)

### 4.4 Challenge window and guardian veto (the honest trust statement)

- `proposeRoot` opens a `challengeWindow` (launch proposal: **8 hours**; §10-Q4) before the root finalizes and claims open.
- During the window, anyone can recompute the root with the reference implementation. The independent **watcher** (existing alert-watcher infra, extended) recomputes every proposal automatically and alarms on mismatch.
- A mismatch is resolved by the **guardian** (owner; pauser may also hold the veto key) calling `vetoRoot(drawId)` — which discards the proposal and reopens proposing. Veto can never move funds, never touch a finalized root, and never block principal withdrawals.
- **Limitation, stated plainly:** V5.0's challenge is guardian-veto, not a bonded permissionless fraud proof. If the guardian and the proposer collude (or the guardian sleeps through a bad root's window), a wrong winner set finalizes — bounded to that draw's prize, never principal. This must appear in user-facing docs in this honest form. Bonded challenges are the named upgrade path.

## 5. Prize, fees, sponsors

### 5.1 Prize accounting (per draw)

At `startDraw`: `grossYield = strategy.totalAssets() − totalPrincipal − undistributedPrize`, where `undistributedPrize` is the running ledger of finalized-but-unclaimed prize value plus rolled-over skipped prizes. Fee is carved per §5.3; the remainder plus any reward-token legs scheduled for this draw (§5.4) form the draw's **prize legs**, snapshotted into the draw record. Rounding dust and negative-yield periods (possible under a venue loss event): a draw's prize floor is zero — yield deficits reduce nothing for depositors (principal ledger is untouched) and are recovered out of subsequent yield before any new prize accrues.

**Minimum prize threshold (cold-start / late-deposit answer).** An owner-tunable `minPrizeThreshold`: if a period's accrued prize is below it, the draw is skipped and the prize **rolls into the next period** (same mechanism as the zero-prize skip in §3.4). This handles the operator-raised cold-start concern — "if everyone deposits late, the first prize is tiny" — by never paying out an embarrassingly small jackpot; instead the displayed prize grows until it clears the bar. Note the concern is structurally self-limiting under TWAB: deposits persist across draws (no rounds to exit), so a "late" deposit is early for every subsequent draw, and late depositing is privately irrational anyway (near-zero TWAB = near-zero odds). Launch-week prizes can additionally be seeded via sponsor top-ups (§5.4, 5a/5b).

### 5.2 R2 in V5.0 vs V5.1

The **mechanism** (multi-token prize legs, `(token, amount)` leaves, reward funding) ships in V5.0. The **product** (a protocol self-serving a branded campaign with eligibility) is V5.1's CampaignManager, which composes these primitives externally — `createCampaign` will hold the sponsor's budget and call `fundPrize` per draw. That is the test of D2: if V5.1 needs a core change, V5.0's design failed review.

### 5.3 Fees (R6)

- **6b:** fee = `feeBps × feeBase`, where the base is a **value delta**, never a share count. Correct under rebasing and emissions by construction.
- **6a:** per-vault `feeBase` flag: `TOTAL_PRIZE` (yield + reward legs) or `PARTICIPANT_YIELD_ONLY` (reward-token legs and sponsor-attributable yield exempt; sponsor-attributable yield = grossYield × sponsorPrincipal / totalPrincipal, computed at snapshot). ADR-0026's rejection of participant-only is explicitly reversed, per ADR-0034.
- **6c:** the fee on each leg is taken **in that leg's token** (yield-leg fee in the deposit asset; reward-leg fee in the reward token, when base = TOTAL_PRIZE). No cross-token conversion in the core, ever (a swap in the fee path would import oracle/DEX risk into settlement).
- Recipients/splits/caps (≤8 recipients, ≤20% total, per-draw snapshot) carry over from ADR-0027 unchanged. Fee payouts are leaves in the draw tree (§3.5).

### 5.4 Sponsors (R5 — all four, mapped)

| Model | V5.0 mechanism |
|---|---|
| **5a** — reward in a different token | `fundPrize(token, amountPerDraw, numDraws)`: schedules reward-token legs across the next N draws. Tokens are **owner-allowlisted in V5.0** (§7.5). Non-refundable once a covered draw starts; unstarted scheduled legs are sponsor-cancellable. |
| **5b** — same-token, unstaked, direct | `fundPrize(depositAsset, …)` — held raw by ClaimManager, paid as a raw-asset leg, never staked. |
| **5c** — principal-retaining, yield-only, recurring | `sponsorDeposit()` (§3.2): TWAB-delegated-to-zero, so it earns yield into every draw's prize with zero win odds. **Under a continuous model, "auto-roll" is not a feature — it's the absence of rounds.** One deposit sponsors every draw until withdrawn. |
| **5d** — redeem retained principal | Sponsor calls the ordinary withdraw. Non-pausable like all withdrawals. |

The V4 `sponsor()`-donates-everything mode is retired; 5b+5c compose to cover it.

## 6. The V5.1 seam (what V5.0 must expose and freeze)

For D2 to hold, these V5.0 interfaces are **frozen** at V5.0 audit time: `fundPrize` (campaign funding), the leaf encoding `(drawId, account, token, amount)` (campaign distributions), `TwabController` read API (eligibility-by-TWAB), and the draw-record read surface. The CampaignManager becomes a privileged-only-as-funder external contract. **Eligibility** (snapshots/Merkle allowlists) lives entirely in V5.1's winner-algorithm extension (a campaign draw filters the account set by the campaign's eligibility root before sampling) — algorithm-version bump, zero core change. The algorithm spec is versioned for exactly this reason.

## 7. Security analysis

### 7.1 The no-loss invariant under venue loss

If the strategy venue itself loses value (shMON exploit/slash), `totalAssets < totalPrincipal` is possible. Stance (unchanged from V4, now explicit): **EverDraw does not insure venue risk.** Withdrawals become pro-rata against remaining assets via the emergency-shares path; the invariant tested is "no depositor can be made worse off by *EverDraw's* accounting than by holding the strategy shares directly," not "EverDraw survives venue insolvency." Docs must state this.

### 7.2 External dependencies (working rule #5 — each one, with its failure answer)

| Dependency | Failure mode | Design answer |
|---|---|---|
| **shMON / yield venue** | Paused, withdraw-reverting, rate-manipulated, insolvent | Emergency share exit (§3.2); value-delta accounting reads at snapshot only; venue insolvency = pro-rata (§7.1); strategy swap behind 24h timelock |
| **Future strategies** | Malicious/buggy adapter drains held assets | Per-adapter audit obligation; timelocked swap = public exit window; swap reverts on value shortfall |
| **Pyth Entropy** | Down / never calls back | Draw stalls in AwaitingSeed; re-request after timeout (V4 pattern); deposits/withdrawals unaffected; oracle swap via ADR-0029 timelock |
| **Keeper (Fly)** | Dead | Every keeper action permissionless after grace (§4.3) |
| **Keeper** | Malicious root | Determinism + watcher recompute + challenge window + guardian veto (§4.4); exposure bounded to one draw's prize |
| **Reference implementation / indexer** | Bug → wrong root proposed honestly | Two independent implementations, differential-tested as a release gate; watcher recompute catches divergence in the window |
| **Reward tokens (5a)** | Fee-on-transfer, rebasing, reentrant, blacklisting tokens | V5.0 allowlist; balance-measured receipt on funding; per-leaf defer-on-failure isolates a blacklisting token to its own leaves |
| **Monad chain** | Reorg around seed/proposal | Proposal waits for finality on the seed tx (cheap given Monad fast finality; watcher enforces); contracts use timestamps, not block numbers |
| **Merkl** | (consumer, not dependency) | Event shapes preserved (ADR-0006); points unaffected by the V5 cutover |

### 7.3 Smart-contract concerns (audit checklist seeds)

- **Reentrancy:** native MON in deposit/withdraw/claim paths — CEI + `nonReentrant` everywhere assets move; claims pay the leaf account, so claim reentrancy gains nothing.
- **TwabController:** ring-buffer overwrite correctness at wraparound; cumulative-balance overflow bounds; observation timestamp ties (multiple updates in one block); binary-search edge cases at period boundaries. Property/fuzz tests + (recommended) the PoolTogether lineage.
- **4626 inflation / donation attacks:** first-depositor share inflation on the strategy (virtual-offset or dead-shares mitigation in ShmonStrategy); direct-donation to vault or strategy must only ever increase the prize (value-delta accounting absorbs donations as yield — verify no path where a donation corrupts principal accounting).
- **Draw boundary gaming:** TWAB makes deposit-timing worthless, but verify the snapshot ordering in `startDraw` (prize snapshot vs TWAB period end) admits no same-block sandwich.
- **Root proposal:** `totalPayout` must exactly equal the sum of snapshotted legs; a finalized root is immutable; veto cannot touch funds; double-claim impossible per leaf (claimed-bitmap per draw).
- **Pause/stop semantics:** enumerate every external function × {paused, stopped} and assert withdrawals/claims/emergency-exit are live in all states — as an invariant test, not a review note.
- **Arithmetic:** prize-leg sums ≤ funded amounts; rounding dust accrues to `undistributedPrize`, never strands.

### 7.4–7.6 (consolidated)

**Griefing:** dust-account blowup of the off-chain compute → min-deposit + O(n log n) reference implementation, load-tested at 100k accounts (release gate). **Token allowlist:** V5.0 reward tokens owner-allowlisted; permissionless tokens are a V5.1+ decision with its own ADR. **Governance:** PM initially recommended landing ADR-0031's owner→multisig migration before V5.0 mainnet (V5 adds veto + allowlist powers to the owner key). **Operator decided otherwise (Q7, 2026-06-10): single Ledger at V5 launch**, on the grounds that funds at risk are unchanged from V4, the new powers cannot move funds, strategy swap retains its 24h exit window, and the dominant residual risk (key loss) is identical to what was already accepted. Multisig stays on the roadmap (ADR-0031).

## 8. Migration and coexistence (D3)

- V4.1-A and V4.1-B run unchanged through the entire V5 build. The V4.1-B deploy (+3.5d, stagger guard) proceeds as planned. Merkl points continue on V4.1.
- **Migration UX is two transactions, by design:** V4.1 `withdrawPrincipal` returns shMON shares → V5 `depositShmon` accepts them directly (the V4.1 shMON path was built for Merkl, but it is also exactly the migration rail). Frontend ships a guided "Move to V5" flow; no approval-to-V4, one approval to V5.
- **V4.1 retirement (only after V5.0 has run ≥4 clean weekly cycles):** stop accepting V4.1 deposits via `stop()`, final rounds settle, withdrawals stay open forever (V4 invariant), frontend marks legacy. Reserve recovery per the existing V4-A retirement runbook.
- Merkl/shMonad must be notified of the V5 addresses ahead of cutover so points migrate without a gap (same event shapes — ADR-0006).

## 9. Rejected alternatives

- **Dual-mode (rounds + TWAB coexisting):** rejected by D1. Two mechanics forever, double audit surface, contradicts the public promise.
- **Fully on-chain winner selection:** rejected by D4 — caps winners near V4's 32 and re-imports the gas cliff R4 exists to remove.
- **Trusted keeper root (no challenge window):** rejected — converts a gas optimization into a trust grant on prize funds.
- **True push distribution (contract loops transfers at settlement):** rejected — unbounded gas, and one revert blocks the batch; keeper-executed merkle claims deliver the same UX with per-leaf isolation.
- **Proportion-based deferred claims (vs fixed amounts):** rejected — breaks `totalPayout` verifiability of proposed roots; rebasing drift handled at the strategy layer instead.
- **In-vault TWAB (no separate controller):** rejected — forces a TWAB rebuild for factory/MegaDraw/V5.1 campaign pools.
- **Swap-to-deposit-asset fees (6c via DEX):** rejected — imports DEX/oracle risk into settlement; fees stay in-kind.
- **Contract-level V4→V5 migration function:** rejected by D3 — couples V5 to V4 internals for a one-time event that two transactions already cover.

## 10. Open decisions, risks, blockers

**Operator decisions — RESOLVED 2026-06-10:**
- **Q1 — Draw cadence: weekly at launch**, shorten later via the tunable. (Daily remains the phase-2 promise; weekly is operationally gentler — 52 vs 365 VRF fees + root cycles/yr, larger per-draw prizes.)
- **Q2 — Winner structure: 1 winner, 100% of the prize at launch.** Count + tier split are per-draw-config parameters, changeable between draws without redeploy.
- **Q3 — Min deposit: 0 at launch**, owner-tunable so a minimum can be enforced later (the tunable also backs the §7.4 anti-dust mitigation when needed).
- **Q4 — Challenge window: 8 hours** (PM recommendation accepted by default; operator had no objection once the mechanism was explained).
- **Q5 — No proposer bond in V5.0** (PM decision). Veto + per-draw single-active-proposal + cooldown is sufficient at launch scale; add a bond only if root-spam griefing actually occurs.
- **Q6 — External audit DEFERRED (operator decision: no budget).** PM-imposed mitigation, non-negotiable in lieu of the audit: **a configurable total-deposit cap on PrizeVaultV5 at launch** — set to a loss-tolerable level, raised as confidence builds, removable if an audit is later funded. Cheaper paths to pursue in parallel: Monad Foundation ecosystem audit support; competitive platforms (Code4rena/Sherlock) at a fraction of boutique-firm cost. See risk register.
- **Q7 — Multisig: stays deferred (single Ledger at V5 launch), per operator.** Operator's reasoning accepted: funds at risk are unchanged from V4 and that risk was already accepted; the new owner powers (veto, allowlist) cannot move funds, and strategy swap retains its 24h public exit window. The dominant residual risk is key loss, identical to V4. ADR-0031 remains the roadmap item. (Supersedes the §7.4–7.6 pre-decision recommendation.)

**Builder decisions (flag in design review, no operator input needed):** adapt-vs-greenfield TwabController (§3.1 — recommendation on record); observation packing/capacity; claimed-bitmap layout; native-MON wrapping at the strategy boundary.

**Blockers:**
- **B1 — ~~External audit before mainnet~~ resolved as: deposit cap in lieu of audit (Q6).** The cap is now a launch-gating feature: V5.0 MUST NOT take uncapped deposits while unaudited.
- **B2 — The off-chain pipeline is half the system.** Winner computation, watcher recompute, keeper claim execution carry the same correctness weight as the contracts and are in-scope for the same review/test gates (build plan M3/M6).
- **B3 — ~~Operator decisions Q1–Q7~~ resolved 2026-06-10.** No remaining operator blockers to build start.

**Top risks:**
- **Unaudited principal-holding code (Q6 deferral)** — now the #1 protocol risk. Mitigated, not removed, by the deposit cap; the cap level is the explicit "amount we can afford to lose to an undiscovered bug." Revisit the deferral if Monad Foundation support or a cheaper competitive audit becomes available.
- **TwabController correctness** — the central engineering risk; mitigated by §3.1's adapt recommendation + property/differential testing.
- **Guardian-veto trust model** — honest-docs obligation (§4.4); reputational if discovered rather than disclosed.
- **Prize latency expectation** — "daily draw" headlines vs seed+proposal+window reality (~9–12h post-period); set expectations in docs/UI from day one.
- **Scope leak V5.1→V5.0** — the §6 seam is the contract; PM enforces at review.
- **A second protocol generation in ~one quarter** — V4.1 user comms must make "deposits move, nothing is lost, points continue" unmistakable.

## Related

- Execution plan / milestones / test plan: `tasks/v5-build-plan.md`
- Requirements: ADR-0034 · Handoff + failure record: `tasks/v5-design-handoff-to-builder.md`
- Carried forward: ADR-0006 (Merkl surface), ADR-0027 (fee router recipients), ADR-0028 (payout *guarantee*), ADR-0029 (randomness), ADR-0031 (multisig)
- Retired in V5: ADR-0010 (stagger), ADR-0024/0025 (rounds/tickets), ADR-0026 (sponsor model)
