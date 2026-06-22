# V5 M8 — operator checklist (step by step)

What the **operator** must do to unblock and complete M8. Pulled from the M8 runbooks (`v5-m8-testnet-deploy-runbook.md`, `v5-m8-draw-ops-runbook.md`, `v5-m8-veto-runbook.md`). Agents/builder never hold keys.

Sequencing: Steps 1–3 in parallel → 4 → 5 → builder does 6 → operator does 7 → 8.

## STEP 1 — Create wallets (operator)
Monad **testnet, chain id 10143**.
- Create/nominate 3 wallets you control: **deployer**, **keeper**, **watcher**. Keep all keys.
- Fund each with testnet MON (faucet).
- Record the 3 **addresses** only.

## STEP 2 — healthchecks.io (operator)
- Free account. Create 2 checks: `keeper` (5min/5min), `watcher` (15min/5min).
- Each → ≥2 alert channels (email + one of SMS/Slack/PagerDuty). Email-only not acceptable.
- Copy the 2 ping URLs.

## STEP 3 — Watcher host off-Fly (operator)
- Any host that is NOT Fly (Render/Railway/VPS/home box). No shared fate with the keeper (the V4.1 blind-spot fix).
- Ready for the builder to deploy the watcher onto.

## STEP 4 — Hand off to builder
Provide: deployer address, keeper address, watcher address, 2 healthcheck URLs, watcher host access.

## STEP 5 — Deploy testnet (operator signs)
- Builder preflights + preps command; operator runs the operator-only deploy from the approved M8 branch with the deployer key.
- Record addresses/txs/config; update `deployments/monad-testnet.json` ONLY (never mainnet).

## STEP 6 — Builder runs soak (builder)
≥3 accelerated cycles + keeper-outage drill + config-drift drill. Builder produces evidence. Operator waits.

## STEP 7 — Veto drill (operator, hands-on, launch-gating)
1. Builder injects a bad root on testnet.
2. Watcher alarms (draw id, proposed root, recomputed root, diff).
3. Operator independently verifies the mismatch.
4. Operator calls `vetoRoot(drawId)` from the guardian key.
5. Confirm `RootVetoed` → corrected root → finalize → claim.
6. Capture txs as evidence.

## STEP 8 — Signal done
Operator tells PM "M8 done." PM verifies all drill evidence, then writes the M9 mainnet runbook.

## Separate / anytime (not blocking M8)
- Send the Merkl submission (`tasks/v4.1-merkl-submission-package.md`).
- Set `VITE_POSTHOG_KEY`/`HOST` if enabling analytics.
- Eyeball the beta UI live on everdraw.xyz (`tasks/beta-ui-safety-changes-2026-06-22.md`).
