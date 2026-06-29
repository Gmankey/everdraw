# Builder ticket — Degen-pool security hardening (contract + monitoring)

**Date:** 2026-06-30. **From:** PM. **For:** Builder. **Implements:** ADR-0042. **Why:** close the instant-drain admin holes before a large Degen-pool deposit.

## 1. Timelock fund-affecting admin functions (PrizeVaultV5)
- `setDrawManager` currently has **no timelock** — it's the most direct drain path (a malicious draw manager can escrow/withdraw vault assets). Put it behind a **queue → commit-after-delay** timelock, mirroring the existing `queueStrategyChange/commitStrategyChange` 24h pattern (reuse `STRATEGY_CHANGE_DELAY` or a dedicated constant). Emit a `DrawManagerChangeQueued` event so monitoring can alert.
- **Audit the rest of the owner surface** for any other instant fund-affecting power and apply the same treatment (or document why it's safe instant). Non-fund-affecting/safety functions (`pause`, `stop`) should stay instant.
- Tests: queued change can't take effect before the delay; cancel works; a withdraw remains possible throughout the timelock window.

## 2. Admin-change monitoring + alerting
- Extend the protocol monitor (`scripts/protocol-monitor.js` lineage) to watch the V5 vault and **alert** on: queued strategy change, queued draw-manager change, ownership transfer (pending/accepted), pause/stop, deposit-cap change. Fire the healthcheck-fail / alert URL so the operator sees it within the timelock window.
- This is what makes the timelock useful — the operator must learn of a queued change in time to react + withdraw.

## Acceptance
- `setDrawManager` (and any other instant fund-affecting fn found) is timelocked + emits a queued event; full test coverage.
- Monitor alerts on all admin-change events above against a live testnet vault.
- Deliver as your own committed PR citing ADR-0042.

## Out of scope (operator/ops, not builder)
- Owner → multisig (Gnosis Safe) on mainnet.
- Phased-ramp deposit policy + cap sizing.
- Scoped external audit / bug bounty before large capital.
