# V5 launch-readiness checklist — single source of truth

**Updated:** 2026-07-07. **Owner:** PM tracks; builder/ops execute. **Rule #5/#6:** every dependency named, failure mode known, verified on the live surface before "done."

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
- [ ] **Keeper as a managed service** (ticket 1) — no soak is meaningful while the keeper is a manual terminal process (it has died repeatedly). Prerequisite for everything below.
- [ ] **Auto-compound redeployed on UAT** (ADR-0043): new ClaimManager + DrawManager, timelocked `vault.setDrawManager`, keeper executes compounds, frontend opt-out toggle. Re-point keeper + indexer + frontend to the new addresses.
- [ ] **One uninterrupted soak, no code changes**, exercising the paths only unit-tested or hit piecemeal so far:
  - Full-withdraw reset **and** partial LIFO withdrawal (only the withdrawn newest tranche loses tenure).
  - Streak → tier → multiplier progression across several checkpoints (now works after #193/#195; verify at a representative cadence).
  - Each bonus branch at least once: loss-streak 10/26/52, comeback-king (rejoin after 2+ missed draws), streak milestones 2/4/13/26.
  - Auto-compound end-to-end: a win lands as a fresh tenure-0 tranche; an opted-out winner is paid to wallet; a paused-vault claim falls back to wallet (never bricks).
- [ ] **Keeper catch-up efficiency** (ticket 2) — so recovery after any downtime isn't minutes-per-draw.

## B. Production deploy + cutover
- [ ] **Mainnet contract deploy** (chain 143): real shMON + real Pyth, **weekly** TWAB period (testnet ran hourly), deposit cap / min-deposit, through the existing `deploy:preflight` + bytecode-verify checks. Needs a mainnet deploy runbook.
- [ ] **Indexer → V5 on mainnet**: the live `everdraw-indexer` still runs V4.1 round-based code. Bring it to the V5 ingestion code, point at mainnet V5 addresses via the canonical reconciliation control (not hand-set secrets), backfill. Must **dual-serve V4.1-B** during the sunset window (ADR-0044) — don't drop the old pool until it's drained.
- [ ] **Frontend cutover on the real `everdraw.xyz` Vercel project** — today V5 only exists on the isolated `everdraw-v5-uat` project. Cutover = V5 mode + mainnet addresses + production indexer URL + wallet allowlist, with V4.1-B behind "Previous Vault" + the migration prompt (ADR-0044). Not "done" until verified on the live production surface (rule #6).
- [ ] **Monitoring/alerting on mainnet** — keeper liveness (scaffolding exists on the keeper fly app), vault solvency/shortfall, indexer lag. The absence of exactly this caused the silent V4.1-A reserve incident.
- [ ] **User docs** for the TWAB model (continuous tickets, Patron pool, points) — `docs/how-it-works/` still describes the round-based product.

### B external-dependency detail (carried from the prior checklist)
- **Merkl — NEEDS RE-CONFIRM.** V5 changed the surfaces Merkl reads: participant points from the real transferable ERC-4626 share (ADR-0039), Degen points from the distinct `BoostDeposit`/`BoostWithdraw` event stream (ADR-0040). Re-confirm Merkl indexes both correctly against V5 before mainnet.
- **MetaMask / Blockaid — STRUCTURALLY FIXED, allowlist at launch.** Honeypot signature is gone in V5 (real transferable share; Degen is events, not a token). Residual: generic new-contract caution. Submit V5 mainnet contracts for Blockaid/MetaMask allowlisting + Sourcify-verify at launch.
- **External providers — verify each at deploy.** Pyth entropy (verified on testnet; confirm mainnet addresses), shMON (real mainnet ERC-4626 vs the testnet mock), RPC. Verify each address in `deployments/monad-mainnet.json` works on the live surface.
- **Alchemy monthly limit — NOT viable for public launch on free tier.** V5 grows RPC load (frontend reads, keeper polling, indexer scans). Minimum for launch: a **paid RPC plan** + read caching (`rpcCache.js`, batch/debounce), and ideally a separate RPC for indexer/keeper so frontend traffic doesn't compete. Budget decision.

## C. Decisions
- [x] **Auto-compound (ADR-0043)** — IN launch scope (operator, 2026-07-07). Sequenced per above.
- [x] **V4.1-B (ADR-0044)** — withdraw-only sunset, no forced migration, points nudge to V5. PM call, 2026-07-07.
- [ ] **Security review scope — OPEN, operator decides.** ADR-0042 was honest that there is **no external audit yet**. With real funds — and especially with auto-compound adding a new ClaimManager⇄Vault call path — decide: full external audit, scoped review, or bug-bounty-only. This gates a real-money launch and is a budget decision. The auto-compound diff (PR #196) is the reviewable artifact.

## Priority order
1. Keeper→fly (A) · 2. Auto-compound redeploy on UAT (A) · 3. Security-review decision + kickoff (C) · 4. Soak (A) with monitoring (B) · 5. Paid RPC (B) · 6. Indexer→mainnet, frontend cutover, allowlist (B).
