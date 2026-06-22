# EverDraw V5 M7 Second Adversarial Review

**Date:** 2026-06-22
**Scope:** ADR-0036 M7 extended internal review after M6.
**Auditor:** Internal EverDraw second-pass review.
**Status:** Complete for local deterministic review/tests. Monad fork execution remains gated by `MONAD_MAINNET_RPC_URL`.

## 1. Executive Summary

M7 re-reviewed the V5 launch surface adversarially after the M6 integration/audit pass. The focus was narrower than M6: do the contract controls actually bound unaudited principal risk, do the M6 failure answers still hold under hostile assumptions, and what deposit-cap launch value should be proposed to the operator.

No new critical or high-severity contract issue was found. One M7 coverage gap was fixed: deposit-cap tests now explicitly cover direct shMON deposits, sponsor deposits, rollback of a reverted direct-shMON cap hit, and withdrawals after the owner lowers the cap below current principal.

## 2. Deposit-Cap Launch Proposal

**Proposed launch cap:** `25,000 MON` total principal cap on `PrizeVaultV5.depositCap`.

Rationale:

- The cap is the explicit Q6 replacement for a third-party audit at launch; it should be a real loss bound, not a symbolic number.
- `25,000 MON` aligns with the current beta frontend ticket-risk posture while still allowing a meaningful early cohort.
- The cap is owner-tunable and only gates new deposits. Withdrawals, sponsor withdrawals, and emergency share exits remain live even if the cap is lowered below current principal.
- The operator still owns the final "affordable loss" decision. This report proposes the number; it does not approve the operator's risk budget on their behalf.

Suggested staged raises:

1. Launch: `25,000 MON`.
2. After 3 clean V5 draw cycles and successful keeper/watcher drills: `50,000 MON`.
3. After 8 clean cycles or an external/competitive audit pass: `100,000 MON+`, subject to operator approval.

Important distinction: the current frontend per-wallet ticket cap is a UX/safety guard. The M7 launch cap must be enforced by `PrizeVaultV5.depositCap`; the UI cap is not a protocol risk bound.

## 3. M7 Review Findings

### M7-01 - Deposit-cap coverage did not explicitly test every deposit path

**Severity:** Medium for launch confidence.
**Status:** Fixed.

The existing unit suite tested native participant deposit cap behavior, but the cap is the primary unaudited-principal risk bound and should be visibly covered across all principal entry paths.

Fix:

- Added `test_depositCapAppliesToDirectShmonAndSponsorDeposits`.
- Added `test_loweringDepositCapBelowCurrentPrincipalDoesNotBlockWithdrawals`.
- The direct-shMON cap-hit test also asserts the reverted transfer attempt leaves user shares intact.

### M7-02 - Direct-shMON cap checks happen after strategy share transfer call

**Severity:** Low.
**Status:** Accepted with rationale.

`depositShmon` and `sponsorDepositShmon` need an asset value for incoming shares before applying the asset-denominated cap. The current strategy path transfers shares then previews redeemed asset value; if the cap check reverts, the whole EVM call tree reverts and the token transfer is rolled back.

M7 added explicit rollback coverage for this behavior. A future hardening option is to add a read-only strategy preview method so the cap can be checked before the transfer call, but this is not required for V5.0 with the current shMON transfer semantics.

### M7-03 - Literal Monad fork lifecycle test not locally executed

**Severity:** Process / coverage.
**Status:** Accepted for M7 local review; remains a launch gate before M9.

`test/v5/PrizeVaultV5Fork.t.sol` exists and covers native MON, direct shMON, and full mixed-asset lifecycle against real shMON, but this machine currently has no `MONAD_MAINNET_RPC_URL`. The fork suite therefore cannot be honestly marked as locally executed in this pass.

This does not block producing the second adversarial report and cap proposal, but it must block any claim that fork coverage has passed.

## 4. Checklist Re-Review

| Area | M7 result |
|---|---|
| Deposit cap | Contract cap gates participant native MON, direct shMON, sponsor native MON, and sponsor direct shMON deposits. Withdrawals remain live after cap reductions. |
| Withdrawal liveness | Existing tests plus new cap-reduction test confirm the cap never blocks exits. Pause/stop withdrawal liveness was already covered. |
| Shortfall mode | M6 venue-failure test still covers pro-rata withdrawal and emergency share exit. |
| Oracle stall | M6 fix and tests cover timeout re-request and stale request invalidation. |
| Keeper death | M6 test covers permissionless fallback. |
| Bad root | M6 test covers veto, reproposal, and finalize. |
| TWAB / draw-boundary gaming | Existing TWAB differential/invariant coverage plus M6 lifecycle coverage remain the main mitigations. M8 should still include watcher drills. |
| Frontend/analytics | Not a contract dependency. PostHog funnel instrumentation is configured separately for beta insight. |

## 5. Required Before Launch

- Run the Monad fork suite with `MONAD_MAINNET_RPC_URL`.
- Operator explicitly approves or revises the `25,000 MON` launch cap.
- Deploy script/runbook must set `depositCap` before deposits open.
- M8 testnet soak must execute the bad-root veto drill and keeper-outage fallback drill with watcher alerts live.

## 6. Conclusion

M7 is complete as an internal second adversarial pass. The recommended launch deposit cap is `25,000 MON`, subject to operator risk acceptance. The cap behavior now has stronger test coverage across deposit paths and cap-lowering exit behavior.
