# Builder ticket — V5 keeper automation (M8 prerequisite)

**Date:** 2026-06-23
**Status:** Active blocker for M8 full-stack soak. Builder honestly flagged: existing keeper scripts are V3/V4-style and do not run the V5 loop. Deploy prep + watcher are ready; this is the remaining gap.
**Cites:** ADR-0036 §3.4 (permissionless startDraw, "keeper does it in practice"), §4.3 (liveness/permissionless fallback), §3.5 (claimMany). Gate: `tasks/v5-build-plan.md` M8 (keeper part).
**Branch:** continue the V5 line; cut `feat/v5-keeper` from `staging`.

## What to build
A first-class **V5 keeper** that drives the full on-chain loop on a schedule, signing with the operator-held keeper key:

`startDraw → write-watch-inputs (build root input) → compute root (compute-winners.js) → proposeRoot → (after challenge window) finalize → claimMany / emit proofs`

Reuse existing components — do NOT reimplement:
- `scripts/draw/compute-winners.js` (root computation — must match the Python reference / watcher).
- `scripts/draw/write-watch-inputs.mjs` (the input the watcher also consumes — keeper and watcher must build identical inputs).
- DrawManagerV5 ABI (startDraw, proposeRoot, finalizeRoot) + ClaimManager (claimMany).

## Hard requirements
- **Operator-held key only.** Keeper signs with the operator's testnet keeper wallet (`0x629Bd7f323fD29E3dF75855C9BC542889c6c1268`). No agent-generated/held key. Key supplied via env/secret the operator controls.
- **Keeperless fallback must stay intact.** Every action the keeper takes is permissionless after grace (§4.3) — the keeper is automation, not a trust dependency. The M8 keeper-outage drill kills the keeper and completes a cycle via permissionless calls; design so that still works.
- **Idempotent / reconciles on restart** — never double-acts (don't re-propose a finalized draw, don't double-claim). Read on-chain state first.
- **Heartbeat** — ping the keeper healthcheck (`KEEPER_HEALTHCHECK_URL` / `https://hc-ping.com/df536db3-abc1-444c-bf26-87625cc1d4c4`) each successful loop; alarm on error (Telegram, existing pattern).
- **Root parity** — the root the keeper proposes MUST equal the watcher's recompute and the Python reference (the differential gate). If they ever diverge, do not propose; alarm.

## Gate (this ticket done when)
- [ ] Keeper runs the full loop end-to-end on testnet (≥1 complete cycle: deposit present → startDraw → propose → finalize → claim).
- [ ] Keeper-outage drill passes: kill keeper mid-cycle, permissionless fallback completes the cycle, keeper restarts and reconciles without double-acting.
- [ ] Heartbeat pings observed; error path alarms.
- [ ] Proposed root matches watcher + Python reference on every cycle.

## Sequencing
- **Parallel:** the testnet deploy (`npm run deploy:testnet:v5`, operator signs) does NOT depend on this — run it now. Keeper starts once both this script exists AND `DRAW_MANAGER_ADDRESS` is set post-deploy.
- After this: full M8 soak (≥3 cycles + outage + config-drift drills) → operator veto drill → PM verifies → M9 runbook.

## PM follow-up
Verify the keeper loop on testnet (re-run a cycle, confirm root parity + heartbeat + idempotent restart). Then resume the M8 gate.
