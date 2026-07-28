# ADR-0045: V5 is shMON-share-denominated end-to-end — no on-chain redeem to MON

**Status:** Accepted — implemented in PR #231 (commit `c7914e9`) and deployed to Monad testnet UAT 2026-07-22. Verified on-chain: `vault.payoutToken()`, `drawManager.payoutToken()`, and `strategy.shareToken()` all return the shMON address; the synchronous `redeem`-to-MON paths were removed from the contracts. Spec confirmed with operator 2026-07-22.
**Supersedes:** the native-MON yield-leg escrow in ADR-0036 §3.5
**Resolves:** the open question in ADR-0034 R1 ("do winners receive the underlying asset (strategy redeems on their behalf) or a strategy claim token?")
**Depends on / consistent with:** ADR-0023 (shMON dependency model — protocol operates in shMON terms, explicitly rejects redeeming to MON)

## Context

Redeeming shMON → MON on shMONAD is subject to an **18–22 hour unbonding delay**. Operator confirmed 2026-07-22 that **there is no instant/liquid redeem path** — *all* shMON→MON redemptions are delayed, regardless of size. This is a hard external-dependency constraint (CLAUDE.md working rule 5).

Two places in the deployed V5 code call `strategy.withdraw` → `shmonVault.redeem`, which assumes a **synchronous** redeem:

1. **Principal / sponsor / boost withdrawals** — `PrizeVaultV5.withdraw()`, `withdrawSponsor()`, `boostWithdraw()` (via `_withdrawParticipant`/`_withdrawSponsor`, `strategy.withdraw`).
2. **Prize funding** — `PrizeVaultV5.escrowYield()` (line 339) → `strategy.withdraw(amount, claimManager)`. ADR-0036 §3.5 (M0 amendment) specified that `startDraw` escrows the yield leg into ClaimManager **as native MON**.

Both assumptions are **false on mainnet shMON**. They pass in UAT only because `MockERC4626YieldVault` redeems instantly — the mock has masked this defect across five vault iterations.

The share (non-redeeming) paths already exist and are correct: `withdrawShmon()`, `withdrawSponsorShmon()`, `boostWithdrawShmon()` → `strategy.withdrawShares` (transfers shMON shares, instant).

## Decision

**V5 holds, escrows, and pays out everything in shMON shares. No contract path ever redeems shMON → MON. MON conversion is always the user's own shMONAD unstake (18–22h), performed after they hold the shares.**

Concretely:

1. **Principal/sponsor/boost withdrawals return shMON shares.** The redeeming variants (`withdraw`, `withdrawSponsor`, `boostWithdraw`, `_withdrawParticipant`, `_withdrawSponsor`, and any other `strategy.withdraw` call site that sends to a user) are removed or re-pointed at `strategy.withdrawShares`. There is no on-chain "give me MON" withdrawal. Leaving a redeem method that reverts on mainnet is a landmine and is not acceptable.

2. **Prize/yield escrow moves shMON shares, not MON.** `escrowYield` (and the DrawManager `startDraw` yield-leg escrow it serves) withdraws the yield leg out of the strategy into ClaimManager as a **fixed number of shMON shares** via `strategy.withdrawShares`, not `strategy.withdraw`. Merkle leaf amounts for the yield leg are **shMON share amounts**. Claims pay shMON shares.

3. **ADR-0036's drift-free guarantee is preserved, not weakened.** ADR-0036 §3.5 escrowed native MON so that leaf amounts are fixed and claims never depend on share price / venue liveness. A **fixed shMON share count** is equally fixed and drift-free: shMON is an appreciating-share (non-rebasing) ERC-4626, and **V5.0 ships `ShmonStrategy` only** (ADR-0036 §3.3). After the snapshot, a leaf is "N shMON shares," which does not change with share price or rebasing. Drift between proposal and claim remains structurally impossible.

4. **Winners and withdrawers convert to MON themselves on shMONAD** (18–22h unbonding), exactly like principal. The frontend routes the "convert to MON" action to the share-withdrawal method plus a shMONAD redirect, and the UI states the 18–22h wait.

5. **Future rebasing / non-share strategies (R3, post-launch)** need their own escrow primitive; a fixed share count is only drift-free for appreciating-share venues. This is out of scope for V5.0 (ShmonStrategy only) and is a per-adapter obligation named at that time.

## Guardrail against recurrence (required)

The root cause of this recurring miss is a test mock that redeems synchronously. The builder must add a **delayed-redeem mock** (`redeem` queues/reverts rather than delivering assets synchronously, mirroring shMON unbonding) and cover the deposit → draw → escrow → claim → withdraw path against it. Any code that assumes synchronous shMON redeem must fail in CI, not in production. See `memory/feedback_shmon_out_never_instant_mon.md`.

## Consequences

- **Requires a contract change and redeploy** of PrizeVaultV5 / DrawManager / ClaimManager before mainnet. This is why catching it pre-mainnet matters — the alternative was discovering it after launch.
- The frontend "convert to MON" button becomes an on-chain shMON-share withdrawal + shMONAD redirect (no on-chain redeem).
- No user- or prize-facing native-MON payout exists on-chain anywhere in V5. Docs and UI must reflect "you receive shMON; convert to MON on shMONAD (~18–22h)."

## Rejected alternatives

- **Keep ADR-0036 §3.5's native-MON escrow.** Infeasible: the redeem cannot settle synchronously at `startDraw`; every draw would stall 18–22h (or revert). Rejected on the confirmed no-instant-redeem constraint.
- **Hold a native-MON reserve to fund prizes / withdrawals ourselves.** Already rejected in ADR-0023 (defeats the principal-in-yield-asset premise; adds custody/insolvency surface).
- **Instant-redeem path for small (yield-sized) amounts only.** Operator confirmed no such path exists on shMON.

## Implementation record

- **PR #231** (`feat: denominate V5 payouts in shMON shares`, squashed to `c7914e9`): removed `ShmonStrategy.withdraw()` and the `redeem` interface entry; re-pointed `escrowYield` and all participant/sponsor/booster withdrawals at `withdrawShares`; added `depositShmonFor` so prize auto-compound (ADR-0043) restakes shMON shares as a fresh tranche; added `MockShmonDelayedRedeem` (its `redeem()` reverts) with the full deposit→draw→escrow→claim→withdraw lifecycle covered against it. 297 Forge tests pass with the delayed-redeem mock in-suite.
- **Deployed to UAT** 2026-07-22 (deploy commit `c7914e9`, deploy block 47042467); DrawManager timelock committed and the keeper/indexer/frontend re-pointed. Draws 81–90 finalized and auto-claimed in shMON, emitting `ClaimPaid` + `PrizeCompounded`, indexed as `source=prize_compound`.
