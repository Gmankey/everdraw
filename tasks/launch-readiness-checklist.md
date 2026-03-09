# Everdraw Launch Readiness Checklist

Date opened: 2026-03-05 (AEDT)
Owner: PM / Eng
Status: IN PROGRESS

---

## Gate 1 — Keeper Reliability (Gate C formal)

**GO criteria:** all checkpoints PASS with no critical incidents.

### T0 anchor (fresh run)
- [ ] Restart keeper service and record timestamp
- [ ] Record keeper start log line (must include `preflight=true`)
- [ ] Record pool address / chain id

### T+6h checkpoint
- [ ] `systemctl status monad-prize-keeper.service` excerpt captured
- [ ] `keeper.out` summary captured (errors/heartbeat/last mined tx/last pending)
- [ ] wallet balance captured
- [ ] settle-preflight proof captured (`preflight=true` + no settle revert-tx spam)
- [ ] PASS/FAIL recorded

### T+12h checkpoint
- [ ] systemd status captured
- [ ] keeper summary captured
- [ ] wallet balance captured
- [ ] settle-preflight proof captured
- [ ] PASS/FAIL recorded

### T+24h checkpoint
- [ ] systemd status captured
- [ ] keeper summary captured
- [ ] wallet balance captured
- [ ] settle-preflight proof captured
- [ ] PASS/FAIL recorded

### Alerts
- [ ] Telegram alert health verified during run
- [ ] Any incidents documented with timestamp/impact/mitigation

**Gate 1 verdict:** [ ] GO  [ ] NO-GO

---

## Gate 2 — Post-Settle UI

**GO criteria:** winner/loser states and actions are clear and functional.

- [ ] Winner display visible after settlement
- [ ] Loser principal amount visible
- [ ] Withdraw CTA visible + functional
- [ ] Claim CTA visible for winner (yield > 0)
- [ ] Status line visible: `Vault [N] settled. Your principal is available to withdraw.`

**Gate 2 verdict:** [ ] GO  [ ] NO-GO

---

## Gate 3 — Live Vault Lifecycle QA

**GO criteria:** one full lifecycle observed via UI and on-chain transitions confirmed.

- [ ] Buy via UI works
- [ ] Commit observed
- [ ] Draw observed
- [ ] Settle observed
- [ ] Timer behavior correct through each phase
- [ ] UI state transitions update without manual hard refresh

**Gate 3 verdict:** [ ] GO  [ ] NO-GO

---

## Gate 4 — Wallet UX Regression

**GO criteria:** all critical wallet paths are clean.

- [ ] Connect flow clean
- [ ] Wrong network guardrail shown and blocks tx
- [ ] User rejection handled cleanly (no noisy red error spam)
- [ ] Successful tx shows confirmation clearly

**Gate 4 verdict:** [ ] GO  [ ] NO-GO

---

## Gate 5 — Visual QA

**GO criteria:** approved visuals on desktop + mobile.

- [ ] Desktop pass (latest vault-door design)
- [ ] Mobile pass
- [ ] Circular progress ring behavior accepted
- [ ] Typography/spacing card copy approved

**Gate 5 verdict:** [ ] GO  [ ] NO-GO

---

## Final Go/No-Go Decision

- [ ] Gate 1 passed
- [ ] Gate 2 passed
- [ ] Gate 3 passed
- [ ] Gate 4 passed
- [ ] Gate 5 passed

**Launch Decision:** [ ] GO  [ ] NO-GO

Decision timestamp:
Decision by:
Notes:
