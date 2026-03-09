# PM Status Update — Everdraw Mainnet Validation Snapshot (Revised)

**Date:** 2026-03-04 (AEST)
**Project:** Monad Prize / Everdraw
**Revision reason:** Incorporated PM review feedback and converted into execution plan.

---

## Executive status

- **Protocol state:** Not stuck. Prior ticketed round (`rid=12`) is `Settled`.
- **Ops status:** Needs remediation before sign-off.
- **Gate C:** **NOT PASSED** (evidence incomplete + alerting/preflight concerns in previous run).
- **Deployment status:** Current pool has wrong ticket price (`0.01 MON` vs PM-locked `0.1 MON`) and is now treated as **test-grade only**.

---

## PM findings accepted

1. **Settle preflight effectiveness concern**
   - Prior evidence showed repeated revert errors during settle window.
   - Action: strengthen preflight gating in keeper to block tx on any failing precheck (especially settle path), with explicit “no tx sent” logging.

2. **Telegram alerting was non-functional (`fetch failed`)**
   - Action: harden alert transport (retry + timeout + fallback path) and perform live alert test.

3. **Gate C evidence incomplete**
   - T+6h/T+12h/T+24h checkpoints not complete.
   - Action: restart Gate C on corrected deployment and capture all required checkpoints.

4. **Ticket price deployment mismatch**
   - PM confirms mismatch is deployment/config error, not intentional canary.
   - Action: redeploy with PM-locked params and repoint keeper.

5. **~0.8% principal loss round-trip**
   - Current assessment: likely ShMonad economics; not enough data to label contract bug.
   - Action: communicate clearly in UX/copy and validate with additional scenarios.

---

## PM decisions now locked

- **D1:** Manual withdrawal stays (with explicit user comms)
- **D2:** Validation complete requires minimal UX completion
- **D3:** Additional multi-ticket / multi-wallet scenario required before production sign-off
- **D4:** Ops status line approved (with winner-yield addendum)

---

## Evidence snapshot (current)

- `currentRoundId = 177`
- `activeFinalizingRoundId = 0`
- `nextExecutable = None`
- Ticketed rounds: only `rid=12`, state `Settled`, tickets `1`, principal `0.01 MON`, `lossRatio=0.991989...`, `yield=0`.

Interpretation: core lifecycle completed for test round; no active settlement backlog.

---

## Immediate execution plan (approved)

### 1) Ops fixes now
- [x] Keeper preflight hardened (block tx when precheck fails; explicit no-tx log)
- [x] Keeper Telegram sender hardened (timeout/retries/fallback)
- [x] Live Telegram alert test run and captured (`scripts/keeper-alert-test.sh`)

### 2) Test-financial closeout on current (wrong-param) deployment
- [x] Execute `withdrawPrincipal(12)` from buyer wallet
- [x] Record tx hash + post-withdraw balance delta in evidence
  - tx: `0x8dea22e42aa465efe50effccbb66a68339dc268ebdd12fabc84cd16da6e591fb`
  - wallet delta (net after gas): `+0.00257630213328933 MON`
  - `principalMON(12, buyer)` after tx: `0`

### 3) Redeploy (blocking for production)
- [x] Redeploy with locked params (on active testnet validation network):
  - ticket price `0.1 MON`
  - commit delay `10`
  - round duration `604800`
  - new pool: `0x2E297C5dFf5557eA8C2D1101E082A58F02a8C3a1`
- [x] Update `POOL_ADDRESS` in keeper env + docs
- [x] Mark old pool test-only in docs
- [ ] Restart keeper service to load new env (requires sudo operator step)

### 4) Gate C restart on corrected deployment
- [~] Started: new Gate C evidence file created (`tasks/everdraw-gate-c-evidence-2026-03-04.md`)
- [ ] 24h burn-in with checkpoints: T+6h, T+12h, T+24h (starts after keeper restart)
- [ ] Multi-ticket + 2-wallet scenario
- [ ] Winner/loser withdraw paths confirmed
- [ ] Winner claim flow confirmation (yield may be 0)

### 5) UX minimum completion
- [ ] User-facing status after settle:
  - `Round [N] settled. Your principal is available to withdraw.`
  - If winner and yield>0: `You won! Prize available to claim.`

---

## PM sign-off criteria to proceed

1. Ops fixes verified (including live Telegram alert path)
2. Correct-parameter deployment live and keeper pointed correctly
3. Gate C evidence complete on corrected deployment
4. Minimum user comms in place
