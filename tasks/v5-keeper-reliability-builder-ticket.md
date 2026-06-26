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
