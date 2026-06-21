# EverDraw V5 M6 Internal Audit

**Date:** 2026-06-22
**Scope:** V5 integration and dependency-failure gate for ADR-0036 M6.
**Auditor:** Internal EverDraw security review.
**Status:** M6 internal pass complete for deterministic integration and failure-injection coverage. Literal Monad fork lifecycle coverage has been added but local execution remains environment-gated by `MONAD_MAINNET_RPC_URL`.

## 1. Executive Summary

M6 reviewed the V5 vault, draw, claim, TWAB, and shMON strategy integration as a system rather than as isolated milestones. The pass added a dedicated M6 integration suite covering mixed native-MON and direct-shMON depositors, multi-draw settlement, keeper fallback, oracle stall and seed re-request, venue shortfall, emergency exit, and bad-root veto/reproposal.

One M6 finding was identified and fixed: `DrawManagerV5` had the documented "oracle death -> re-request after timeout" design requirement in ADR-0036, but no implemented re-request function. The fix adds timeout-governed seed re-request support while preserving live deposits and withdrawals.

No critical or high-severity issue was found in this M6 pass. V5 is still pre-launch and not third-party audited; the external audit remains a later gate before TVL scaling.

## 2. Scope

In scope:

- `src/v5/PrizeVaultV5.sol`
- `src/v5/DrawManagerV5.sol`
- `src/v5/ClaimManagerV5.sol`
- `src/v5/twab/EverdrawTwabController.sol`
- `src/v5/strategies/ShmonStrategy.sol`
- V5 mock strategy/oracle integration tests
- ADR-0036 §7.2 external-dependency assumptions
- ADR-0036 §7.3 smart-contract checklist

Out of scope:

- shMON internals beyond the ERC-4626 surface consumed by `ShmonStrategy`
- Pyth Entropy internals beyond the oracle adapter boundary
- Production keeper/watcher deployment infrastructure
- Frontend, analytics, and off-chain winner pipeline implementation
- M7 second adversarial audit pass
- M8 testnet soak and M9 mainnet cutover

## 3. Methodology

The review combined:

1. Manual lifecycle review from deposit through draw start, seed, root proposal, challenge, finalize, claim, and withdrawal.
2. Failure-mode review against ADR-0036 §7.2 and the M6 builder ticket.
3. Focused Foundry integration tests in `test/v5/V5M6IntegrationAudit.t.sol`.
4. Regression checks against existing V5 vault, draw, and claim suites.
5. Checklist review against ADR-0036 §7.3.

## 4. Findings

### M6-01 - Oracle stall had no implemented seed re-request path

**Severity:** Medium
**Status:** Fixed

ADR-0036 §7.2 says a randomness oracle outage should stall the draw in `AwaitingSeed`, allow re-request after timeout, and keep deposits/withdrawals unaffected. Before M6, `DrawManagerV5` could request the first seed and receive callbacks, but there was no public timeout path to replace a dead request.

The fix adds:

- `seedRequestTimeout`
- `seedRequestedAt(drawId)`
- `setSeedRequestTimeout(uint64)`
- `rerequestSeed(uint256 drawId)`
- stale request invalidation via `drawIdByRequestId`
- `SeedRerequested` and `SeedRequestTimeoutUpdated` events

The M6 oracle-death test now verifies the draw stalls, early re-request reverts with the retry timestamp, deposits and withdrawals remain live while stalled, the old request becomes invalid after re-request, and the new request can seed the draw.

### M6-02 - Full live fork gate is environment-dependent

**Severity:** Process / coverage
**Status:** Accepted with rationale for this internal pass

The M6 ticket calls for a full lifecycle E2E on fork. The repo now has an env-gated fork lifecycle test that deploys V5 contracts on a Monad fork, uses real shMON for native and direct-shMON deposits, donates real shMON yield, runs seed/root/finalize/`claimMany`, and withdraws principal.

For M6, the deterministic integration suite covers the full lifecycle and every required failure scenario in local CI. The remaining fork obligation is to execute `test/v5/PrizeVaultV5Fork.t.sol` with a usable `MONAD_MAINNET_RPC_URL`. This is not treated as silently complete; it remains a gate item to verify before M7 sign-off if the PM requires literal fork execution for this milestone.

## 5. External Dependencies and Failure Answers

| Dependency | Assumption | Failure mode | M6 answer |
|---|---|---|---|
| shMON / yield venue | ERC-4626 accounting and share transfers behave as expected | pause, withdraw revert, rate manipulation, insolvency | `PrizeVaultV5` enters shortfall mode on value loss; emergency share exit remains live; deposits/draws halt in shortfall |
| ShmonStrategy | Adapter only moves funds for its configured vault | adapter bug or wrong vault wiring | constructor/owner wiring tested locally; strategy swap remains a future audited/timelocked operation |
| Future strategies | Each adapter honestly reports and moves assets | malicious/buggy adapter drains or misprices assets | per-adapter audit required; out of M6 implementation scope |
| Randomness oracle | Request ID maps to one draw and callback is authentic | oracle never calls back | `rerequestSeed` after timeout; stale request IDs invalidated; deposits/withdrawals unaffected |
| Randomness oracle | Callback only from configured oracle | spoofed callback | `onRandomnessReceived` checks `msg.sender == randomnessOracle`; test coverage exists in draw suite |
| Keeper / primary proposer | Keeper starts draws and proposes roots promptly | keeper dead | permissionless `startDraw`; permissionless `proposeRoot` after grace; M6 failure test covers fallback |
| Keeper / primary proposer | Proposed root is deterministic and correct | malicious or wrong root | challenge window plus guardian veto; repropose/finalize path covered by M6 bad-root test |
| Guardian | Guardian only vetoes invalid roots | guardian unavailable | finalized roots require challenge window, but lack of guardian weakens bad-root response; accepted operational trust until M7/M8 watcher drills |
| ClaimManager | Registered roots and claim bitmaps are authoritative | double claim or wrong leaf payout | leaf hashing, bitmap claims, `claimMany`, and reserve accounting covered by claim and M6 lifecycle tests |
| Reward tokens | Allowlisted reward tokens transfer predictably | fee-on-transfer, blacklist, rebase, failed transfer | V5.0 reward token allowlist; failed claims defer at claim layer; existing claim tests cover deferred token failure |
| TWAB controller | Historical average balances are correct across period boundaries | wraparound, timestamp tie, binary-search error | dedicated TWAB unit, differential, and invariant suites exist; M6 uses TWAB balances in lifecycle path |
| Monad chain / RPC | Events and historical state can be read by keeper/watcher | archive RPC down, event reads incomplete | two-provider watcher/keeper policy remains operational; not directly enforceable on-chain |
| Reference implementation / indexer | Off-chain winner set matches contract leaf encoding | wrong root proposed honestly | watcher recomputation plus challenge/veto; M7 should independently re-run reference implementation review |
| Frontend / DNS / Vercel | Users can access normal UI | frontend unavailable | contracts remain callable directly; no M6 contract dependency on frontend |
| Alerting | Operator is notified of keeper/oracle/root failures | silent outage | M8 operational drill item; M6 tests encode the contract-side failure answers |
| Owner / admin key | Owner config changes are intentional | bad config or lost key | owner powers cannot withdraw depositor principal; timeout/grace config should be reviewed before deploy |

## 6. ADR-0036 §7.3 Checklist

| Concern | M6 status |
|---|---|
| Reentrancy | Asset-moving paths in `PrizeVaultV5` and `ClaimManagerV5` use `nonReentrant`; the new seed re-request path updates state before refunding excess oracle fee. |
| TWAB wraparound / overflow | Covered by existing TWAB unit, differential, and invariant suites. M6 lifecycle asserts mixed-depositor TWAB balances feed draw snapshots. |
| 4626 inflation / donation | Existing `PrizeVaultV5` tests cover donation/yield accounting and direct-shMON deposit/withdraw paths. M6 adds mixed native/direct-shMON lifecycle coverage. |
| Draw-boundary gaming | Draw start snapshots completed period data; M6 lifecycle runs after period rollover. More adversarial timing fuzzing remains appropriate for M7. |
| Root / claim arithmetic | Existing draw/claim tests cover root registration, reserves, `claimMany`, and failed transfers. M6 adds finalize + keeper `claimMany` in full lifecycle and bad-root recovery. |
| Pause / stop matrix | Existing vault tests assert withdrawals, sponsor withdrawals, and emergency exits remain live when paused/stopped; deposits are blocked. |
| Venue shortfall | M6 failure test verifies shortfall mode, pro-rata withdrawal haircut, and emergency share exit. |
| Oracle stall | Fixed in M6 with timeout re-request and stale-request invalidation. |
| Keeper death | M6 failure test verifies permissionless fallback. |

## 7. Verification Artifacts

- `test/v5/V5M6IntegrationAudit.t.sol`
- `test/v5/DrawManagerV5.t.sol`
- `test/v5/PrizeVaultV5.t.sol`
- `test/v5/ClaimManagerV5.t.sol`
- `test/v5/EverdrawTwabController*.t.sol`
- `test/v5/PrizeVaultV5Fork.t.sol` for env-gated real-shMON fork checks, including full V5 lifecycle

## 8. Conclusion

M6 now has an internal audit artifact, dedicated integration/failure coverage, and an env-gated full-lifecycle fork test. The contract change made during the pass fixes a real gap between ADR-0036 and implementation: oracle seed requests can now be re-issued after timeout without blocking user deposits or withdrawals.

Before declaring the PM's literal fork gate complete, run the fork-dependent tests with a Monad RPC endpoint.
