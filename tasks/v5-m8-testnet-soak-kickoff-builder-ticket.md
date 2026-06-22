# Builder ticket — V5 M8: Testnet soak + launch-gating drills (KICKOFF)

**Date:** 2026-06-17
**Status:** Active. M1–M7 merged to `staging` (all PM-verified; live fork gate run). M8 is launch-gating — these are hard gates, not best-effort (M0 finding 6).
**Cites:** ADR-0036 §7.2 / M8. Gate: `tasks/v5-build-plan.md` M8.
**Branch:** cut `feat/v5-m8-testnet-soak` from `staging`.

## Scope — full stack on testnet
Deploy the **whole stack** (contracts, keeper, watcher, indexer, frontend) to testnet and soak for **≥3 full draw cycles at accelerated cadence**.

## Gate (ALL launch-gating — hard, not best-effort)
- [ ] ≥3 full accelerated draw cycles complete end-to-end (deposit → draw → seed → root → finalize → claim → withdraw).
- [ ] **Veto drill — operator personally executes** one deliberately-injected bad root on testnet (runbook written AND run by operator, not builder).
- [ ] **Keeper-outage drill** — kill the keeper; permissionless fallback (startDraw/proposeRoot) completes a cycle without it.
- [ ] **Dead-man heartbeats live** on keeper AND watcher via an independent channel (healthchecks.io email, the V4 protocol-monitor pattern already proven in prod).
- [ ] **Watcher hosted off-Fly** (no shared fate with keeper — the exact V4.1 blind-spot failure mode).
- [ ] **Config-drift drill** — point keeper at a wrong vault on testnet; reconciliation alert fires within SLA (the V4.1-A incident, as a drill).
- [ ] Draw timing pinned inside **operator waking hours**.
- [ ] Runbooks written: deploy, draw-ops, strategy-swap, veto.

## Standing rules
- **No agent-held keys** — keeper/watcher signing keys are operator-created/custodied; the keeperless fallback is part of the drill.
- The **25,000 MON depositCap is operator-approved** (`tasks/v5-launch-params-operator-approved.md`) — exercise cap behavior on testnet too.

## Operator-owned items in this milestone (flag early so they're scheduled)
- The **veto drill is hands-on operator** (per Q-gate). Builder writes the runbook; operator runs it on testnet.
- Operator provides/nominates the testnet keeper & watcher wallets (no agent keys).

## Out of scope
M9 (mainnet cutover) — after all M8 drills pass.

## PM follow-up
Verify each M8 gate item with evidence (drill logs, heartbeat dashboards, off-Fly watcher host). Coordinate the operator veto drill. Then M9 runbook (PM writes; operator+builder execute).
