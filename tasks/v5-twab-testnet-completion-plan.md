# V5 TWAB — testnet completion plan

**Date:** 2026-06-26. **Owner:** PM (drives/verifies). **Goal:** TWAB working and tested to completion on testnet.
**Parent ticket:** `tasks/v5-twab-design-closure-builder-ticket.md` (#150). **ADRs:** ADR-0036 (TWAB), ADR-0039 (transferable share), ADR-0037 (cadence).

> Division of labor: **builder** makes all `src/` + `test/` + `scripts/` code changes; **PM** writes specs/docs, verifies deliverables, and runs the deploy + soak. Everything below marked "Builder" is a code change and must be passed to the builder — the PM does not author it.

## Status

- ✅ **TWAB-1** phantom-TWAB — period-grid alignment guard + zero-TWAB skip. Merged #152, PM-verified.
- ⬜ **TWAB-D** deploy-script alignment (`scripts/deploy-v5-testnet.js`). **Builder — code.** Spec below. The current default (`firstPeriodStart = offset + 300`) is off the TWAB grid (`300 % 3600 ≠ 0`) — the deploy-side cause of draw-11 — and DrawManagerV5's new guard now *rejects* it, so a redeploy fails until this is fixed.
- ⬜ **TWAB-2** re-enable TWAB-on-transfer (ADR-0039 share). **Builder — src.**
- ⬜ **TWAB-3** explicit cadence-drift test. **Builder — test.**
- ⬜ **Testnet redeploy (aligned) + soak to completion.** **PM-run.** Runbook below.

---

## Builder work order

Full scope/acceptance for TWAB-2/3 is in #150. Do them in order: **TWAB-D, then TWAB-2, then TWAB-3.**

### TWAB-D — deploy-script TWAB-grid alignment (`scripts/deploy-v5-testnet.js`)
Make the deploy script produce params that satisfy DrawManagerV5's alignment guard, and fail fast otherwise. Required behavior:
- `drawPeriod % twabPeriodLength == 0` — assert; throw with a clear message if not.
- `twabPeriodOffset <= block.timestamp` — assert (TwabController already requires it).
- `firstPeriodStart` must land on the TWAB grid: `(firstPeriodStart − twabPeriodOffset) % twabPeriodLength == 0`.
  - If `FIRST_PERIOD_START` is set explicitly: **validate** it (throw if off-grid) — do not silently re-snap.
  - If not set: default to the requested start (`now + FIRST_PERIOD_DELAY_SEC`) **snapped up to the next TWAB boundary**: `offset + ceil((now+delay − offset)/periodLength) * periodLength`.
- Log the resolved `firstPeriodStart / twabPeriodOffset / drawPeriod` and the alignment remainder so the operator can eyeball it before the stack deploys.
- (Diagnosis is done; this is a faithful translation of the guard into pre-deploy checks. ADR-0036 §3.4, mirrors the #152 constructor guard.)
- Gate: dry-run the script's param resolution (no broadcast needed) and confirm it throws on a misaligned `FIRST_PERIOD_START` and snaps correctly on the default path.

### TWAB-2 — re-enable TWAB-on-transfer
- M1 stripped user transfer/delegation; ADR-0039 makes the position a real transferable ERC-4626 share. Re-introduce the upstream balance-transfer path: a mid-period transfer updates **both** sender and receiver observations atomically.
- A late transfer-in must yield ~zero current-period odds (same timing-attack immunity as a late deposit, ADR-0036 §3.4). Sponsor-delegated balances stay excluded across transfers.
- Re-point/extend `test/v5/EverdrawTwabControllerDifferential.t.sol` to cover `transfer`/`transferFrom` against pinned PoolTogether commit `29926961b2ecfa89e0f61a6d874c71b6f8e29112`.

### TWAB-3 — cadence-drift test
- `N` consecutive empty periods advance the schedule by exactly `N · drawPeriod`, each a clean `Skipped` with no phantom TWAB and no VRF spend. Ties to ADR-0037 / backlog P1-5. Put it in `test/v5/DrawManagerV5.t.sol`.

### Gate (all)
- `forge test --match-path 'test/v5/*.t.sol' -vv` fully green incl. new cases; update `tasks/v5-m1-twab-gate-evidence-2026-06-15.md`. Deliver into a worktree + report (same flow as TWAB-1).

---

## Testnet redeploy + soak runbook (PM-run, after TWAB-D/2/3 land)

**Why redeploy:** the live M8 DrawManager (`0x266ab124…`) is misaligned and now correctly fails the new constructor guard. Resuming the soak = a fresh aligned deploy, not a keeper restart.

### Deploy params (fast-soak profile)
Use a **short period** so a multi-draw soak completes in ~1–2h instead of ~half a day. With TWAB-D landed the script snaps + asserts alignment, so these are safe:

```
TWAB_PERIOD_LENGTH_SEC=600     # 10 min TWAB grid
DRAW_PERIOD_SEC=600            # one draw per grid period (must be a multiple of TWAB length)
FIRST_PERIOD_DELAY_SEC=120     # snaps up to the next 600s boundary
DEPOSIT_CAP_MON=25000
# TWAB_PERIOD_OFFSET defaults to block.timestamp (<= now, required); leave unset
# FIRST_PERIOD_START: leave unset → auto-snapped & asserted on the grid
```
Confirm the script's printed `(firstPeriodStart − offset) % periodLength == 0` before proceeding (it throws otherwise).

### Wiring after deploy
- Point the keeper (`scripts/keeper-v5.js`) + input-builder at the **new** DrawManager / vault / TwabController addresses; update `deployments/monad-testnet.json`.
- Keeper uses the operator's testnet keeper key (NOT the burned one — standing wallet rule). Confirm healthchecks ping.

### Soak acceptance gates (the "tested to completion" bar)
1. **Normal draw:** deposit across a full period → `startDraw` → seed → `proposeRoot` → finalize → claimable prize. One full happy-path draw.
2. **Empty-period skip (draw-11 regression, live):** one period with **no participant deposits** → `Skipped`/`ZERO_TWAB`, **no VRF spend**, prize rolls forward, `nextPeriodStart` advanced exactly one `drawPeriod`, no phantom `totalTwab`.
3. **Transfer-on-TWAB (TWAB-2, live):** transfer a position mid-period → both parties' TWAB update; a late transfer-in does **not** win current-period odds; off-chain winner builder agrees with on-chain `totalTwab`.
4. **Drift:** ≥2 consecutive empty periods → schedule advances by exactly `N · drawPeriod`, no overlap/gap.
5. **Keeper steady-state:** 0 errors across the above; input-builder matches contract `totalTwab` every draw.

When 1–5 hold across a continuous soak window, TWAB is complete on testnet → un-pause gate cleared.

### External dependencies (working rule #5)
- **Pyth entropy** (`pythEntropy`/`pythEntropyProvider` in `deployments/monad-testnet.json`) — randomness for non-skipped draws; a dead provider blocks finalization.
- **shMON staker** — yield/prize backing; mock on testnet (`DeployMockShmonStaker`).
- **PoolTogether upstream** pinned commit — differential reference of record.
- **Testnet RPC** — dual-RPC already in the input-builder (tenderly logs / official calls).
