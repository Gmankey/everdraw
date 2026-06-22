# V5 launch parameters — operator-approved (2026-06-22)

Durable record of operator decisions so the M9 deploy runbook uses the right values. Not builder-discretionary.

## Deposit cap (Q6 / B1 — launch-gating)
- **`PrizeVaultV5.depositCap` = 25,000 MON** — **APPROVED by operator 2026-06-22.**
- This is the Q6 replacement for a third-party audit: the explicit loss bound while unaudited (per M7 `security_audit/AUDIT_REPORT_V5_M7_2026-06-22.md`).
- Owner-tunable post-launch; only gates new deposits (withdrawals/sponsor-withdrawals/emergency-exit stay live even if later lowered below current principal — M7-tested).
- **M9 deploy gate:** the runbook MUST set `depositCap = 25,000 MON` before deposits open, and live-surface-verify it on-chain (working rule #6). V5.0 must not take uncapped deposits (B1).
- Distinct from the 25,000-ticket frontend UI cap (`tasks/beta-ui-safety-changes-2026-06-22.md`) — numerically equal at 1 MON/ticket but a different control (UI guardrail vs on-chain risk bound).

## Analytics — PostHog (operator decision 2026-06-22)
- **Decision: enabled.** PostHog integration merged (env-gated; `web/src/App.jsx`, `web/.env.example`). Inert until `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` are set.
- **Activation step (operator):** set `VITE_POSTHOG_KEY` + `VITE_POSTHOG_HOST` in the web env (prod + canonical `/web`) to turn it on; verify events flow before relying on funnel reporting.
