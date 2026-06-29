# Builder ticket — V5 keeper reliability (blocks production keeper, not TWAB)

**Date:** 2026-06-26. **From:** PM. **For:** Builder. **Priority:** P1 (before any production V5 keeper run; does NOT block TWAB sign-off — see `tasks/v5-twab-testnet-soak-result-2026-06-26.md`).
**Relates to:** backlog P1-2 (`previewStartDraw` view) and P1-3 (proper indexer for winner-input building). This ticket adds two concrete defects found during the 2026-06-26 testnet soak.

## Context
During the aligned V5 testnet redeploy + soak, the local keeper (`scripts/keeper-v5.js`) **could not drive a single draw**: on restart it produced no output and broadcast zero transactions (nonce unchanged, balance unchanged) — it hung in its action path on the public testnet RPC (`https://testnet-rpc.monad.xyz`). `startDraw` had to be called manually (it's permissionless and simulated cleanly). The contracts were fine; the keeper tooling was not.

## Defect 1 — `getTotalTwabBetween` ABI mismatch (wrong selector, always reverts)
`scripts/keeper-v5.js` `TWAB_ABI` declares:
```
function getTotalTwabBetween(address vault, uint64 startTime, uint64 endTime) view returns (uint256)
```
The deployed contract is `getTotalTwabBetween(address, uint256, uint256)`. The `uint64` fragment produces a **different 4-byte selector**, so every keeper call hits no function and reverts with empty data (`0x`). The keeper currently *interprets* that bare `0x` as "empty / never-deposited period → treat as zero TWAB", so it **mis-reads every funded period as empty**, then relies on the `InsufficientOracleFee` retry to stumble into a real draw. This is fragile and wrong.
- **Fix:** correct the ABI to `uint256, uint256` (and audit any other keeper ABI fragments against the deployed contract — same class of bug may exist elsewhere). After the fix, re-confirm the `0x`-means-empty-period branch only triggers for *genuinely* empty periods (cross-check against `_previousOrAt` returning a zero observation vs. a real revert).

## Defect 2 — keeper hangs on public testnet RPC (no timeout / no resilience)
The keeper stalled indefinitely with no log line before its first action, on an RPC that responded fine to `cast`. Root cause is RPC fragility under the keeper's call pattern; there is no per-call timeout, no retry/backoff on the read path, and no dual-RPC for testnet.
- **Fix:** add per-RPC-call timeouts + bounded retry/backoff on the keeper read path; fail loudly (log + healthcheck-fail ping) instead of hanging silently; support a dual-RPC config for testnet (mirror the input-builder's tenderly-logs / official-calls split already used in `scripts/draw/write-watch-inputs.mjs`). A hung keeper must self-evict (exit non-zero so a supervisor restarts it) rather than appear alive.

## Carry-over (already in backlog — fold in here)
- **P1-2:** add a `previewStartDraw() → (due, willSkip, requiredFee)` view so the keeper stops re-deriving skip/fee logic off-chain (the ABI-mismatch + fee-guess fragility above is exactly this). Add regression tests for all revert paths.
- **P1-3:** replace the RPC-scan winner-input builder with a proper indexer/event-archive for mainnet.

## Acceptance
- Keeper drives a full V5 testnet draw cycle **unattended**: `startDraw` (skip and non-skip), seed wait, `proposeRoot`, finalize, claim — across ≥3 consecutive periods with 0 hangs and 0 manual intervention.
- ABI matches the deployed contract (verified by a call that returns the real TWAB, not `0x`).
- A forced RPC failure causes a logged retry then a non-zero exit, not a silent hang.
- `previewStartDraw` view added + the keeper uses it; revert-path regression tests added.

---

## Round 2 — found in the live unattended soak (2026-06-29, deploy `0x58502275…`)

#161 fixed the startup hang + ABI + added `previewStartDraw`, and the keeper then drove the **full cycle live** unattended — `startDraw` → Pyth seed → `proposeRoot` → `finalizeRoot` → `claim` (draws 7 & 8 fully finalized + claimed; Pyth oracle integration verified live, draw 3 reqId 3155). Two **new** defects surfaced, both of which strand prizes in production:

### Defect 3 — input-builder default log-concurrency hangs on tenderly (silent stall mid-propose)
- `scripts/draw/write-watch-inputs.mjs` defaults `WATCHER_LOG_CONCURRENCY=8`, and the default logs RPC is tenderly (`monad-testnet.gateway.tenderly.co`). Tenderly **hangs under concurrent `getLogs`**. During `proposeRoot` for the first paying draw, the keeper froze at `[seed:dN] scanning … windows` with **no error and no progress for ~8.5 hours**, stalling the paying cycle until restarted with `WATCHER_LOG_CONCURRENCY=1` (sequential → completed in seconds).
- **Fix:** don't ship a default that hangs. Default the log scan to **sequential** (or auto-detect/backoff on a concurrency stall), and/or pick a logs RPC that tolerates concurrency. The input-builder scan needs its own per-window timeout so it can never silently hang the propose step. (Same root theme as P1-3: replace the RPC log-scan with an indexer.)

### Defect 4 — keeper only reconciles the last 5 draws → strands proposed-but-unfinalized draws
- `runOnce` reconciles `firstDrawToReconcile = currentDrawId > 5 ? currentDrawId-5 : 1`. When the keeper fell behind (the Defect 3 hang) and then caught up, **draw 3 — a real 1.9985 MON prize — was `Proposed` but fell outside the last-5 window before it finalized, so the keeper never finalized it.** It's permanently stranded at `Proposed` (observed live). In production this means any prize whose finalize doesn't happen within 5 draws is lost to claimants.
- **Fix:** the keeper must finalize/advance **any** outstanding non-terminal draw (Proposed past its challenge window, Seeded past grace, AwaitingSeed needing re-request), not just a fixed trailing window. Track the oldest unfinalized draw and always include it.

### Round-2 acceptance
- Input-builder completes the winner scan with the shipped defaults (no env override) and **cannot** silently hang — a stalled window times out, logs, and retries/fails loudly.
- A draw proposed-but-not-finalized survives an arbitrary number of subsequent draws and is still finalized + claimed by the keeper (regression test: propose draw N, advance the chain past N+5 draws, assert draw N finalizes).
