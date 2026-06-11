# M0 Pass 3 — Payout Substrate

**Scope:** ClaimManager against winner, fee, reward, and deferred payouts under reverting token, blacklisting token, native-MON send failure, keeper death, pause, and stop.

## Review

- Winner payouts: distribution leaves keyed by `distributionId + leafIndex`; duplicate winner positions remain distinct leaves after this PR's pipeline clarification.
- Fee payouts: ordinary leaves in the same distribution, so fee failure cannot block winner leaves.
- Reward-token payouts: raw tokens are funded/escrowed before distribution; V5.0 allowlist rejects fee-on-transfer, rebasing, and hook-style tokens.
- Yield-leg payouts: after this PR, the yield leg is escrowed into ClaimManager before root proposal, so claim execution does not depend on strategy liveness or share price.
- Deferred payouts: `pendingClaims[distributionId][leafIndex]` stores account, token, amount; duplicate wins, fee overlap, and multi-token failures cannot collide.
- Keeper death: claims are permissionless and self-claim remains available.
- Pause/stop: claims are non-pausable and non-stoppable.

## Findings

Fixed in this PR:

- **F-M0-RR-01:** ADR-0036 previously said yield-leg amounts were settled at proposal time, while prize legs were snapshotted at `startDraw`. That left a strategy-drift/funding gap between snapshot and proposal. ADR-0036 now requires yield-leg escrow before any root proposal.
- **F-M0-RR-02:** The pipeline spec previously aggregated duplicate account/token payouts before assigning `leafIndex`, weakening the stated per-leaf identity model. The pipeline now assigns `leafIndex` before any payout identity can collapse.

No remaining payout-substrate blocker.
