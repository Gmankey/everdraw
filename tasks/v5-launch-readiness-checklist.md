# V5 launch-readiness checklist — single source of truth

**Updated:** 2026-08-11. **Owner:** PM tracks; builder/ops execute. **Rule #5/#6:** every dependency named, failure mode known, verified on the live surface before "done."

## 2026-08-08 reconciliation — final UAT bytecode + independent veto drill

The prior status block below is retained as history, but its M-1, alerting, watcher, RPC, and
operator-input blockers are superseded by this reconciliation.

- **M-1/L-1 closed:** PR #244 fixed the ADR-0045 share-backing mismatch and strategy share-token
  invariant. The final UAT stack was freshly deployed and activated at block `49245338`:
  PrizeVault `0xFAF8d7Fea6CA039f4f5dd1449477A4d8836Ed9A0`, DrawManager
  `0xF7c5ED046A829FE153486C306dd0DF7EBB037C19`, ClaimManager
  `0x7b614F7df10b38857bFbd70c43a7B7cef816dC24`, TWAB controller
  `0xd92951A676C8fB3F593D18C8D38e705fE85e0ea8`, strategy
  `0x955880F91354a6EF24A2E783ff4889b7C0DC1dB3`.
- **Real-shMON fork gate closed:** the dedicated Cancun fork profile remains isolated from the
  Paris production artifacts. The operator reran `PrizeVaultV5Fork.t.sol`: 6 passed, 0 failed.
- **Keeper/alerts closed:** the managed Fly keeper is running with a persistent event cache;
  terminal claim failures are quarantined; Telegram and independent healthcheck transports are
  configured and observed. The 3 MON floor / 6 MON warning thresholds landed in #242.
- **Independent watcher gate closed:** PRs #250-#255 host the watcher off Fly, bound and checkpoint
  its scans, and keep it on the free official Monad log RPC. On 2026-08-08 the operator completed
  the deliberate bad-root drill: watcher mismatch detected, Telegram alarm observed, guardian
  Ledger veto executed, corrected root independently matched, draw finalized, and prize
  auto-compounded. Evidence: `tasks/v5-root-watcher-veto-evidence-2026-08-08.md`.
- **Operator inputs resolved:** guardian and pauser are both
  `0xd5cc1f1D7b78943bDF09541A2ace41B5c6D83431`; the operator's archive-capable Alchemy Monad
  mainnet endpoint is the approved deploy/fork/launch RPC; Telegram is proven; the dead-man URL is
  configured and proven. Values remain operator-managed secrets/config and are never committed.

**Remaining pre-cutover gates:** complete and record the still-unverified clean-soak branches in
section A; then execute the mainnet deploy, managed keeper, indexer backfill/dual-serving,
allowlisting, and production frontend cutover in section B. Merkl/shMonad campaign activation is
post-beta by operator decision (2026-08-11).

---
**Latest no-key preflight:** local build, ABI/source checks, locked mainnet-parameter tests and the
full non-fork Forge suite passed on 2026-08-11. Evidence and explicit remaining boundaries:
`tasks/v5-beta-mainnet-preflight-2026-08-11.md`.


## 2026-07-22 update — post-ADR-0045 shMON-share redeploy + confirmed operator decisions

**Contract state is now final at ADR-0045, not ADR-0043.** After the auto-compound (ADR-0043) redeploy, a further, mandatory redeploy landed: **ADR-0045 — V5 is shMON-share-denominated end-to-end, no on-chain redeem to MON** (PR #231, commit `c7914e9`). This supersedes the native-MON escrow assumption throughout. The shMON→MON 18–22h unbonding means the contract never redeems; users convert on shMONAD themselves. The whole suite is now **297 forge tests** (was 108), incl. a `MockShmonDelayedRedeem` guardrail whose `redeem()` reverts.

- **Deployed + verified on UAT** (2026-07-22): stack at deploy block 47042467; DrawManager timelock committed; keeper/indexer/frontend re-pointed. On-chain checks pass — `vault.payoutToken()`, `drawManager.payoutToken()`, `strategy.shareToken()` all == shMON. Draws 81–90 auto-claimed in shMON, emitting `ClaimPaid` + `PrizeCompounded`, indexed `source=prize_compound`.
- **Opt-out semantics corrected:** auto-compound opt-out now pays the winner **shMON shares to their wallet** (not MON). No in-app MON conversion exists anywhere; the "convert to MON" action is a shMON-share withdrawal + shMONAD redirect with the 18–22h notice.

**Confirmed operator decisions (2026-07-22) — feed the mainnet deploy params:**
- **Beta risk posture:** 25,000 MON deposit cap; external audit **deferred until after beta** (unchanged from §C, reconfirmed).
- **Mainnet minimum deposit:** **0** (no contract minimum) — builder recommendation accepted.
- **Draw cadence:** **weekly**; `firstPeriodStart` = **the launch moment** snapped to the TWAB grid at deploy (no pre-committed calendar slot). Launch gates on readiness, not a date. Drift-free per ADR-0037 (genesis lands wherever launch does).

**Open production blockers (from the 2026-07-22 UAT status note) — by owner:**
- **PM:** ✅ ADR-0045 added to staging (PR #238); this checklist refresh (was stale/pre-ADR-0045).
- **Builder:** guarded mainnet deploy tooling and the managed mainnet keeper config landed in
  #240. ADR-0045 M-1/L-1 remediation landed in #244. The remaining pre-cutover builder/ops gate is
  the recorded clean-soak branches in section A; Merkl/shMonad activation is post-beta.
- **Reviewer:** ADR-0045 focused review completed in #241. The real-shMON fork blocker was
  root-caused as a test-harness EVM mismatch, not an archive-RPC failure; the fork suite is pinned
  to Cancun. M-1/L-1 are closed by #244 and the final UAT redeploy.
- **Ops / operator-supplied:** UAT Telegram + healthcheck transports are enabled and proven;
  real-mainnet-shMON fork tests use the operator's archive-capable free-tier Alchemy RPC and the
  Cancun test profile. Clean-soak branch evidence remains open as listed in section A.

**Operator values resolved:** guardian + pauser, archive-capable RPC, Telegram, and dead-man
destinations are confirmed. Secrets stay in operator-managed secret stores and never enter chat or
the repository.

---

## Status snapshot — the mechanism is proven
Contracts (108 forge tests incl. invariant + fuzz), the full draw lifecycle (startDraw → seed → propose → challenge/veto → finalize → claim), the indexer (event ingestion → tranche ledger → per-tranche entries → points → weekly checkpoint), and the frontend (V5UatExperience) all work end-to-end on testnet UAT, validated to the wei. What remains is **not** more mechanism-proving — it's one clean soak, the production deploy/cutover, and the security review.

## Approved sequence (operator-approved 2026-07-07)
1. Wire the V5 keeper to fly as a managed service → `v5-keeper-managed-service-builder-ticket.md`, then `v5-keeper-catchup-efficiency-builder-ticket.md`.
2. Auto-compound (ADR-0043) is **IN launch scope** — do the ClaimManager+DrawManager+Vault redeploy + timelocked re-wiring so the contracts under test are final BEFORE the soak.
3. Run the clean soak (§A) with monitoring (§B) live.
4. In parallel: the security review (§C) and V4.1-B sunset prep (ADR-0044).
5. Then mainnet deploy + production indexer + frontend cutover (§B).

Long poles = the soak and the security review; start both as soon as the auto-compound redeploy lands.

---

## A. Testing done = a real soak
- [x] **Keeper as a managed service** — Fly-managed, restart-tested, persistent cache mounted,
  Telegram/dead-man transports proven.
- [x] **Final contracts redeployed on UAT** (ADR-0043/0045 + M-1/L-1): fresh full stack,
  timelock committed, keeper/indexer/frontend re-pointed. Auto-compound is the fixed product
  default; there is deliberately no frontend opt-out toggle.
- [ ] **One uninterrupted soak, no code changes**, exercising the paths only unit-tested or hit piecemeal so far:
  - Full-withdraw reset **and** partial LIFO withdrawal (only the withdrawn newest tranche loses tenure).
  - Streak → tier → multiplier progression across several checkpoints (now works after #193/#195; verify at a representative cadence).
  - Each bonus branch at least once: loss-streak 10/26/52, comeback-king (rejoin after 2+ missed draws), streak milestones 2/4/13/26.
  - Auto-compound end-to-end: a win lands as a fresh tenure-0 tranche; if compounding cannot
    complete, the claim falls back to shMON wallet payment and never bricks.
- [x] **Keeper catch-up efficiency** — persistent incremental seed/deposit caches survive restarts;
  after the deliberate outage, the one-time delta backfill completed and subsequent cycles scanned
  only new blocks.
- [x] **Independent watcher + veto drill** — off-Fly watcher detected a deliberately bad draw-137
  root, alerted via Telegram, guardian vetoed from Ledger, watcher matched the corrected root, and
  the keeper finalized and auto-compounded the prize. See the 2026-08-08 evidence record.

## B. Production deploy + cutover
- [ ] **Mainnet contract deploy** (chain 143): execute `tasks/v5-mainnet-deploy-execution-runbook.md` with real shMON + real Pyth, weekly TWAB/draw periods, 25,000 MON cap, zero minimum, preflight, and bytecode verification.
- [ ] **Indexer → V5 on mainnet**: the live `everdraw-indexer` still runs V4.1 round-based code. Bring it to the V5 ingestion code, point at mainnet V5 addresses via the canonical reconciliation control (not hand-set secrets), backfill. Must **dual-serve V4.1-B** during the sunset window (ADR-0044) — don't drop the old pool until it's drained.
- [ ] **Frontend cutover on the real `everdraw.xyz` Vercel project** — today V5 only exists on the isolated `everdraw-v5-uat` project. Cutover = V5 mode + mainnet addresses + production indexer URL + wallet allowlist, with V4.1-B behind "Previous Vault" + the migration prompt (ADR-0044). Not "done" until verified on the live production surface (rule #6).
- [ ] **Monitoring/alerting on mainnet** — keeper liveness (scaffolding exists on the keeper fly app), vault solvency/shortfall, indexer lag. The absence of exactly this caused the silent V4.1-A reserve incident.
- [x] **User docs** for the TWAB model (continuous tickets, Patron pool, points) — rewritten under
  `docs-site/pages/` in #209; route/build follow-ups landed in #215.

### B external-dependency detail (carried from the prior checklist)
- **Merkl/shMonad campaign — DEFERRED UNTIL AFTER BETA.** V5 keeps the participant and Patron event
  surfaces available, but campaign registration and multiplier confirmation are not launch gates.
  Re-confirm both surfaces before enabling external shMonad points.
- **MetaMask / Blockaid — STRUCTURALLY FIXED, allowlist at launch.** Honeypot signature is gone in V5 (real transferable share; Degen is events, not a token). Residual: generic new-contract caution. Submit V5 mainnet contracts for Blockaid/MetaMask allowlisting + Sourcify-verify at launch.
- **External providers — verify each at deploy.** Pyth entropy (verified on testnet; confirm mainnet addresses), shMON (real mainnet ERC-4626 vs the testnet mock), RPC. Verify each address in `deployments/monad-mainnet.json` works on the live surface.
- **RPC capacity — operator decision updated.** The operator's existing archive-capable Alchemy
  Monad endpoint is approved for beta launch and the fork suite; a paid plan is not a launch gate.
  Keep read caching/batching enabled, monitor usage and error rates, and separate operational and
  public traffic later if observed load requires it.

## C. Decisions
- [x] **Auto-compound (ADR-0043)** — IN launch scope (operator, 2026-07-07). Sequenced per above.
- [x] **V4.1-B (ADR-0044)** — withdraw-only sunset, no forced migration, points nudge to V5. PM call, 2026-07-07.
- [x] **Security review scope — DECIDED (operator, 2026-07-14): full external audit is deferred to AFTER beta**, once the product has real users exercising it. Rationale: audit spend is committed against a validated, in-use system rather than a pre-beta target. No scoped review or bug-bounty is being run in the interim unless the operator says otherwise. **This means beta launches WITHOUT an external audit** — an accepted risk for the beta phase, revisited before any broad / high-TVL launch. ADR-0042 remains the honest record that there is no external audit yet; the auto-compound diff (PR #196) plus the ADR-0042 `setDrawManager` timelock (PR #207) are the reviewable artifacts when the audit is commissioned.

## Priority order
1. Finish the open clean-soak branches (A) · 2. Mainnet deploy + managed keeper · 3. Indexer
mainnet backfill/dual-serving · 4. Frontend cutover + allowlisting + live-surface verification (B)
· 5. Post-beta Merkl/shMonad campaign confirmation.
