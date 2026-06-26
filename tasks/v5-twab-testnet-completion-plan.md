# V5 TWAB — testnet completion plan

**Date:** 2026-06-26. **Owner:** PM. **Goal:** TWAB working and tested to completion on testnet.
**Parent ticket:** `tasks/v5-twab-design-closure-builder-ticket.md` (#150). **ADRs:** ADR-0036 (TWAB), ADR-0039 (transferable share), ADR-0037 (cadence).

## Status

- ✅ **TWAB-1** phantom-TWAB — period-grid alignment guard + zero-TWAB skip. Merged #152, PM-verified.
- ✅ **Deploy-script alignment** — `scripts/deploy-v5-testnet.js` now snaps `firstPeriodStart` onto the TWAB grid and hard-asserts alignment (this PR). The old default (`offset + 300`) was misaligned and was the deploy-side cause of draw-11.
- ⬜ **TWAB-2** re-enable TWAB-on-transfer (ADR-0039 share). **Builder — src.**
- ⬜ **TWAB-3** explicit cadence-drift test. **Builder — test.**
- ⬜ **Testnet redeploy (aligned) + soak to completion.** Runbook below.

---

## Builder work order — remaining (do TWAB-2, then TWAB-3)

Full scope/acceptance is in #150. Condensed:

### TWAB-2 — re-enable TWAB-on-transfer
- M1 stripped user transfer/delegation; ADR-0039 makes the position a real transferable ERC-4626 share. Re-introduce the upstream balance-transfer path: a mid-period transfer updates **both** sender and receiver observations atomically.
- A late transfer-in must yield ~zero current-period odds (same timing-attack immunity as a late deposit, ADR-0036 §3.4). Sponsor-delegated balances stay excluded across transfers.
- Re-point/extend `test/v5/EverdrawTwabControllerDifferential.t.sol` to cover `transfer`/`transferFrom` against pinned PoolTogether commit `29926961b2ecfa89e0f61a6d874c71b6f8e29112`.

### TWAB-3 — cadence-drift test
- `N` consecutive empty periods advance the schedule by exactly `N · drawPeriod`, each a clean `Skipped` with no phantom TWAB and no VRF spend. Ties to ADR-0037 / backlog P1-5. Put it in `test/v5/DrawManagerV5.t.sol`.

### Gate (both)
- `forge test --match-path 'test/v5/*.t.sol' -vv` fully green incl. new cases; update `tasks/v5-m1-twab-gate-evidence-2026-06-15.md`. Deliver into a worktree + report (same flow as TWAB-1).

---

## Testnet redeploy + soak runbook (PM-run after TWAB-2/3 land)

**Why redeploy:** the live M8 DrawManager (`0x266ab124…`) is misaligned and now correctly fails the new constructor guard. Resuming the soak = a fresh aligned deploy, not a keeper restart.

### Deploy params (fast-soak profile)
Use a **short period** so a multi-draw soak completes in ~1–2h instead of ~half a day. The deploy script snaps + asserts alignment, so these are safe:

```
TWAB_PERIOD_LENGTH_SEC=600     # 10 min TWAB grid
DRAW_PERIOD_SEC=600            # one draw per grid period (must be a multiple of TWAB length)
FIRST_PERIOD_DELAY_SEC=120     # snaps up to the next 600s boundary
DEPOSIT_CAP_MON=25000
# TWAB_PERIOD_OFFSET defaults to block.timestamp (<= now, required); leave unset
# FIRST_PERIOD_START: leave unset → auto-snapped & asserted on the grid
```
The script prints the resolved `firstPeriodStart / twabPeriodOffset / drawPeriod`; confirm `(firstPeriodStart − offset) % periodLength == 0` in the log before proceeding (it will throw otherwise).

### Wiring after deploy
- Point the keeper (`scripts/keeper-v5.js`) + input-builder at the **new** DrawManager / vault / TwabController addresses; update `deployments/monad-testnet.json`.
- Keeper must use the operator's testnet keeper key (NOT the burned one — standing wallet rule). Confirm healthchecks ping.

### Soak acceptance gates (the "tested to completion" bar)
Drive these on-chain and confirm each:
1. **Normal draw:** deposit across a full period → `startDraw` requests randomness → seed → `proposeRoot` → finalize → claimable prize. One full happy-path draw.
2. **Empty-period skip (the draw-11 regression, live):** leave one period with **no participant deposits** → `startDraw` records `Skipped`/`ZERO_TWAB`, **no VRF spend**, prize rolls forward, `nextPeriodStart` advanced exactly one `drawPeriod`. Confirm no phantom `totalTwab`.
3. **Transfer-on-TWAB (TWAB-2, live):** transfer a position mid-period → both parties' TWAB update; a late transfer-in does **not** win current-period odds; off-chain winner builder agrees with on-chain `totalTwab` (the keeper TWAB-mismatch guard stays quiet).
4. **Drift:** ≥2 consecutive empty periods → schedule advances by exactly `N · drawPeriod`, no overlap/gap.
5. **Keeper steady-state:** 0 errors across the above; input-builder matches contract `totalTwab` every draw.

When 1–5 hold across a continuous soak window, TWAB is complete on testnet → un-pause gate cleared, proceed to V5 mainnet planning (ADR-0039 Merkl event-shape re-confirm + the backlog P1 items remain their own tracks).

### External dependencies (working rule #5)
- **Pyth entropy** (`pythEntropy`/`pythEntropyProvider` in `deployments/monad-testnet.json`) — randomness for non-skipped draws; if entropy is down, draws stall at AwaitingSeed (keeper retry handles transient; a dead provider blocks finalization).
- **shMON staker** — yield/prize backing; mock on testnet (`DeployMockShmonStaker`).
- **PoolTogether upstream** pinned commit — differential reference of record.
- **Testnet RPC** — dual-RPC already in the input-builder (tenderly logs / official calls).
