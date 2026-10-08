# EverDraw V5 — Patron capital-at-risk review
Date: 2026-10-08  
Audience: owner and builder  
Decision: **NO-GO for the proposed 1,500,000 MON Patron deposit. REQUEST CHANGES before increasing exposure.**

## Executive conclusion

The live deployment does not meet a reasonable readiness bar for this allocation. This is not merely a warning that all DeFi has risk: independent local mainnet-fork tests reproduced both full-withdrawal failure and a withdrawal that consumes backing attributable to another depositor. There is also privileged strategy-replacement risk controlled by a single on-chain signing address.

No production transaction was signed or broadcast. No funds were moved, no governance settings were changed, and no deployment was performed. The damaging scenarios below occurred only in isolated simulations.

A private entry list or a withdrawal flow with more clicks does not fix these risks. No audit can establish that hacking or principal loss is impossible.

## Scope and evidence identity

- Canonical source reviewed: fetched origin/staging, immutable commit `dee006ce6a37734f1561351b51582b9b1ce0a411`.
- Isolated review checkout: `/home/c/.openclaw/workspace/.worktrees/v5-patron-capital-review-20261008`.
- Chain: Monad mainnet, ID 143.
- Pinned block: **111477200**, timestamp **2026-10-08 01:19:49 UTC**.
- Block hash: `0xf43a91bd606c6e3357f0f1b8a78681811c1136b095b0847888950e69c1696991`.
- Contract snapshots reproduced using `rpc.monad.xyz` and `rpc1.monad.xyz`. Current share price additionally agreed on `monad.gateway.tenderly.co`.
- Production website asset inspected: `https://everdraw.xyz/assets/index-DTShNWhg.js`. Its configured vault/strategy match the on-chain addresses below. Patron routes use `boostDeposit[Shmon]` and `boostWithdrawShmon`.
- Reviewed custody/accounting/withdrawal and migration code; relevant draw-fee, funding and claim authorization code; Patron frontend routing/allowances; public indexer and on-chain draw state; prior withdrawal remediation and keeper incident evidence; official shMON risk documentation.

This is a decision-focused capital-risk review, not a new exhaustive audit of every EverDraw service or of shMON's entire implementation. It establishes concrete reasons not to fund; it is not a safety certification of untested surfaces.

## Live state

| Item | Pinned result |
| --- | --- |
| PrizeVault | `0x97D9CA6DDD80869A32C951cc75b75D20e1300eDa` |
| Active strategy | `0xA3e037641825B17586cC9B5D4d9473A76f25c44b` |
| shMON | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` |
| DrawManager | `0x266ab124480baDDB4af8Dfe578dDAb9F1Ed7610c` |
| Vault/DrawManager owner | `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2`; zero bytecode, no on-chain multisig threshold |
| Pending strategy / owner / DrawManager | None |
| Total deposit cap | **25,000 MON**, shared across deposit classes |
| Recorded principal | 1.006010100738197926 MON, all participant principal |
| Sponsor / Patron principal | Both zero |
| Strategy accounting assets | 1.006402412606678102 MON |
| Strategy shMON balance | 0.616510436451682373 shMON |
| Paused / stopped / stored shortfall flag | false / zero / false |
| Draw fee | **0 bps**, fee base TOTAL_PRIZE |
| Latest draw | Draw 3, Finalized; weekly period, 8-hour challenge window |

The proposed deposit is **60 times the entire current cap**, not a routine use within the beta limit. A local fork confirmed it reverts with `DepositCapExceeded`. Do not raise the cap to get around the safety review.

Runtime SHA-256 values match the deployment record for the old live components:
- Vault: `f9338b77e0c17656d22119ddd102c670dfc8a8355ae37f764d37feb9d3ef878d`.
- Strategy: `877032b42910ef4fb4ff2ae2c1b9776797c6f9f36e05e792b38a9216a36612b9`.
- DrawManager: `11c792131eefe30037e2681267a86efe22640a990543ce44cbf6392c2ec76d91`.

Earlier source/tooling approval of the withdrawal remediation is **not live incident closure**. The old strategy is still active at the pinned block and no replacement is queued.

## Findings

### PC-01 — HIGH / funding blocker: inconsistent share pricing permits full-exit failure and cross-depositor backing depletion

Source: `src/v5/strategies/ShmonStrategy.sol:65–86`; `src/v5/PrizeVaultV5.sol:486–499,525–546`.

The strategy measures backing with `convertToAssets`, but pays shMON shares using `previewWithdraw`. These are different economic quotes in live shMON. The latter can request more shares than the nominal accounting value removed from the depositor's principal. shMON-input deposits also use `previewRedeem`, rather than the backing conversion basis.

Independent results at the pinned block:

1. The existing participant's normal full exit requests **0.621114522015268758 shMON** against only **0.616510436451682373 shMON** held. Direct mainnet `eth_call` and the fork both revert with `InsufficientShares`.
2. A simulated **1,000 MON native Patron deposit**, within the existing cap, credits 999.913516386417237748 MON. A full Patron withdrawal requires 617.350949776888935035 shMON against 613.151924207244182052 held, including the pre-existing balance. It reverts.
3. In a separate fresh-fork scenario, a **100 MON native Patron deposit followed by its full withdrawal succeeds**, but leaves only **0.220376884078806359 MON of accounting backing** against the other depositor's unchanged **1.006010100738197926 MON principal**. This is approximately **78.09% less backing than that remaining principal**.

The third result is a simulated impact, **not a claim that the live depositor has already suffered this loss**, and not a measured instant native-MON trading profit. It proves that successful withdrawal is not sufficient evidence of fair principal accounting.

The vault's proportional-shortfall payout logic can allocate a deficit to remaining holders; it does not insure them. A false stored shortfall flag before an operation is not a safety proof.

Required closure:
- Resolve the accounting mismatch through an independently reviewed migration/release, rather than treating code approval as deployment.
- Add real-shMON pinned-fork full-exit tests for participant, sponsor and Patron ledgers; native and shMON inputs; sole and mixed holders; first/last withdrawals; post-harvest/claim; dust and shortfall.
- Assert that one depositor's exit cannot decrease the backing owed to unrelated depositors beyond explicitly accepted rounding/loss semantics.
- Verify the actual deployed replacement, immutables, migration transaction, balance conservation, frontend manifest and a small complete exit before reconsidering the cap.
- Review yield escrow under the same pricing model: it uses this same strategy withdrawal primitive.

### PC-02 — HIGH risk under owner compromise: 24 hours is a delay, not independent approval

Source: `src/v5/PrizeVaultV5.sol:244–281`.

The single owner address can queue and commit a strategy change after 24 hours. Cancellation is also owner-only. The existing root guardian's veto is for draw roots, not strategy migration.

Migration checks token identity and the **new strategy's own reported totalAssets**. These checks do not make a malicious replacement trustworthy. An isolated local test with the current vault code:
- rejects an early commit;
- accepts the same-token replacement after the delay;
- permits the replacement to move all simulated backing away while Patron principal records remain.

This test deliberately assumes the owner authority has been compromised; it is not an unprivileged bypass of `onlyOwner`. There is no evidence here that the real owner is compromised.

Required risk reduction: independently controlled multisig signers, verified hardware signing, effective delayed governance with independent monitoring/cancellation, constrained and reviewed migration destinations, and an executable emergency response. Simply transferring ownership to a multisig reduces key risk but does not remove the authority or the underlying contract risks.

### PC-03 — MEDIUM, aggravated by PC-01: no equivalent Patron emergency share exit

Source: `src/v5/PrizeVaultV5.sol:394–427`; frontend `web/src/App.jsx:2491–2500`.

Patron uses the booster ledger. Participant and sponsor have separate emergency share exits; the deployed vault has no equivalent booster entrypoint. On the fork, a Patron cannot use either other ledger's emergency function to redeem its Patron balance.

A strategy-only update cannot add a new function to this deployed vault. Require a documented, independently tested complete Patron exit strategy, including exceptional conditions; if a separate emergency entrypoint is a requirement, assess an audited vault/design change rather than claiming a strategy migration adds it.

### PC-04 — Material residual risk: shMON, governance and native-MON liquidity

All three EverDraw deposit classes share one strategy and one underlying shMON position. The accounting labels are not separate custody containers.

The shMON proxy's EIP-1967 implementation pointer at the review block was `0x8ee4ff5ff50198dcbb7b882a0781f42724dd095f`. This review did not independently audit that entire implementation or certify its governance membership.

Official documentation describes a 3-day upgrade timelock and immediate operational controls. It explicitly distinguishes its rate circuit breaker from a full solvency proof. Some delayed exits can be blocked when the protocol is closed; continued token transfer does not guarantee native-MON redemption. [shMON safety and governance](https://docs.shmonad.xyz/safety-governance/)

Withdrawing from EverDraw returns shMON shares, not an unconditional delivery of the original number of native MON. Native conversion adds liquidity, fee and timing constraints. Official documentation describes a roughly 2% instant-liquidity target, utilization-dependent instant-exit fees, and normal delayed unstaking of 4–5 epochs with possible extra delay. These are not a guaranteed quote for a 1.5M MON exit. [Parameters and fees](https://docs.shmonad.xyz/parameters-and-fees/)

### PC-05 — Operational and disclosure conditions are not satisfied for a large allocation

- The Patron copy currently promises “100% of your initial MON deposit value back as shMON.” That is not a guarantee established by the code or these tests. The blanket “safe and withdrawable anytime” wording elsewhere is likewise too strong.
- Source/frontend strategy address comes from the release manifest; migration acceptance must include the served manifest and actual approval spender, not only the on-chain pointer. Current shMON approvals are amount-limited, which is positive, but correct configuration and signing remain essential.
- Draw 3 is now finalized, superseding the earlier incident's Seeded snapshot. Public indexer health was HTTP 200, database OK, 2 blocks behind the confirmed head at capture.
- Keeper balance was approximately **10.35175 MON**, below the **11.3 MON warning threshold documented in the October 7 incident**. This review did not independently inspect the running service's current private configuration, heartbeat or watcher recomputation evidence.
- A finalized draw and healthy indexer do not prove independent watcher availability, correct future draws, or principal safety. RPC retention, keeper funding, veto monitoring and underlying staking operations remain ongoing dependencies.

Recommend builder incident triage now: pause **new deposits** using the existing authorized controls while preserving exits and planning remediation. Pausing deposits alone does not repair accounting or neutralize existing positions. This is a recommendation; no pause or other live change was executed.

## Should the owner create a private/custom Patron pool?

Not as an immediate workaround. “Only I may deposit” addresses entry permissions, while the demonstrated risks concern shared accounting, privileged custody and the underlying yield provider. More transaction steps do not stop an attacker who controls the required authority. A long withdrawal lock can also prevent escape from an emerging incident.

For the stated goal—subsidizing prizes—the preferred direction is:
1. Keep the **principal outside EverDraw** in independently secured custody.
2. Contribute only a capped periodic prize budget.
3. If the separate treasury holds shMON to earn that budget, explicitly accept shMON's contract/governance/liquidity risk; it has removed EverDraw custody risk, not all risk.
4. If avoiding yield-contract exposure is the priority, keep native MON in cold/multisig custody and fund a fixed marketing/prize budget. That does not itself generate staking yield.

Use a reviewed funding mechanism with a small test, not an arbitrary transfer. Both native and shMON `rewardTokenAllowed` flags on the current DrawManager are **false**, so its scheduled funding route is not presently enabled for those assets.

If a dedicated principal-protected treasury is later desired, specify fixed safe return destinations, independent signer thresholds, no broad approvals/arbitrary external calls, bounded yield-only spending, explicit upgrade constraints and a practical emergency path. New custom code needs its own independent audit and deployment verification; it is not inherently safer.

## Weekly yield estimate for 1.5M MON

Measured directly using `convertToAssets(1e18)` on the same shMON proxy:

| Sample | Block / UTC | MON value per shMON |
| --- | --- | --- |
| Start | 109461200 / 2026-10-01 00:09:06 | 1.628396840129372536 |
| End | 111477200 / 2026-10-08 01:19:49 | 1.632417479254712732 |

Elapsed: **7.0491088 days**. Share-price increase: **0.2469078%**. Simple annualization: **12.7848% APR-equivalent**, not a quoted fixed APR/APY.

`1,500,000 × (end/start − 1) × 7/7.0491088 ≈ 3,677.82 MON per week`

Practical planning estimate: **approximately 3,680 MON-equivalent per full week**, if the recent pace persists and all capital is productively deployed.

At the pinned block EverDraw's draw fee is zero, so no EverDraw percentage haircut is assumed. The observed share-price growth already reflects the underlying economics; do not subtract shMON's commissions again. The rate is variable, not insured or promised. shMON explains that yield accrues through the share exchange rate and depends on staking/MEV and other flows. [Yield mechanics](https://docs.shmonad.xyz/yield/)

This is an economic estimate for a correctly functioning arrangement, **not an endorsement of current Patron custody or a forecast of the buggy adapter's exact escrow output**. Actual first-week contribution depends on deposit timing/credit, draw timing, future rate, configuration and operations. Prize value is currently escrowed in shMON; this is not necessarily 3,680 native MON transferred each week. Gas and native exit costs are excluded.

## Verification performed and limits

- Existing vault unit suite: **46 passed, 0 failed**.
- New capital-risk tests: **7 passed, 0 failed**, comprising 6 pinned-fork cases plus 1 local compromised-owner negative control.
- Fork cases reproduced with both public RPC URLs; snapshots also saved from both providers.
- A passing negative-control test means the unsafe behavior was successfully reproduced, **not that the deployment is safe**.
- No new full invariant campaign, full shMON audit, infrastructure penetration test, private-key custody audit or wallet-signing exercise was performed. No assertion of absence of other vulnerabilities is made.
- Mainnet state is time-specific; a later repair must be verified at a fresh immutable source commit and pinned block.

Evidence in this checkout:
- `scripts/patron-capital-live-probe.cjs`
- `test/v5/PatronCapitalAudit.t.sol`
- `tasks/v5-patron-capital-live-evidence-2026-10-08.json`
- `tasks/v5-patron-capital-rpc1-evidence-2026-10-08.json`
- `tasks/v5-patron-capital-fork-results-2026-10-08.txt`
- `tasks/v5-patron-capital-baseline-results-2026-10-08.txt`
- `tasks/v5-patron-yield-evidence-2026-10-08.json`
- `tasks/v5-patron-indexer-evidence-2026-10-08.json`

Reproduction (read-only mainnet fork; do not broadcast):
```sh
MONAD_MAINNET_RPC_URL=https://rpc1.monad.xyz FOUNDRY_PROFILE=fork forge test --match-path test/v5/PatronCapitalAudit.t.sol -vv
forge test --match-path test/v5/PrizeVaultV5.t.sol -vv
```

## Reconsideration gate

Do not authorize the large deposit merely because a PR merges, the site looks correct, or a draw completes. Require:
- closure of PC-01 on the **actual live deployment**, including mixed-holder capital-conservation tests;
- a tested full Patron exit and exceptional-condition plan;
- independently verified governance/custody hardening proportionate to the allocation;
- explicit acceptance of remaining shMON/native-conversion risks;
- watcher/keeper monitoring and funding evidence;
- a small complete deposit-to-exit rehearsal on the final configuration, followed by a staged allocation with reviewed caps;
- an independent security review of that final release before risking the full amount.

**Final disposition: NO-GO for 1.5M MON in the current Patron Pool.**

