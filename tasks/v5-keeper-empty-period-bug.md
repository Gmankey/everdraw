# Builder bug — V5 keeper crashes on empty-vault TWAB read

**Date:** 2026-06-23
**Severity:** Blocker for the M8 soak (keeper cannot advance past empty periods).
**Found:** first live keeper run on testnet (keeper was never run live before — no key in the build env).

## Symptom
`npm run keeper:v5` against the live testnet DrawManager (`0x266ab124…`) crashes:
```
maybeStartDraw -> getTotalTwabBetween(vault, 1782222805, 1782226405) reverts
require(false) / CALL_EXCEPTION
```

## Diagnosis (verified on-chain)
- Period **has ended** (chain time ≫ periodEnd) — not a timing issue.
- Vault has **zero deposits** (`totalSupply = 0`); the TwabController has **no observations** for it, so `getTotalTwabBetween` reverts for ANY window (confirmed against both the current period and an old elapsed window).
- **The contract is correct:** `startDraw()` static-call on the empty vault **succeeds and returns drawId 1** — the on-chain zero-TWAB skip path works as designed (ADR-0036 §3.4).
- **Root cause is keeper-side:** `maybeStartDraw` (`scripts/keeper-v5.js:~136`) reads `getTotalTwabBetween` before calling `startDraw()`, and that read throws on a no-observation vault, killing the loop before the skip can happen.

## Fix
In `maybeStartDraw` (and anywhere the keeper reads TWAB to decide an action):
- **Tolerate the empty/no-observation revert:** wrap the `getTotalTwabBetween` read in try/catch; on revert treat total TWAB as `0`.
- **Still call `startDraw()`** when the period has ended — the contract skips the empty period cleanly and advances `currentDrawId`. Do not gate `startDraw` on a successful TWAB read.
- Same tolerance for any per-account TWAB reads used in `buildDrawInput` for an empty/zero-participant period (a skipped draw has no winners — don't recompute a root for it).
- Keep idempotency: a skipped draw advances the period; the next loop processes the next period.

## Acceptance
- [ ] Keeper run against the current empty testnet vault advances through the elapsed empty periods (each a clean skip), `currentDrawId` increments, no crash.
- [ ] After a deposit lands in an open period, the keeper runs the full cycle (startDraw → propose → finalize → claim) with JS/Python root parity.
- [ ] Add a regression test (or scripted check) for the empty-period skip path in the keeper.

## After the fix (soak sequence)
1. Operator restarts `npm run keeper:v5` → it skips the backlog of empty periods, reaches the current period.
2. Builder makes test deposits (native MON + direct shMON) into the vault during an open period (draw-ops runbook).
3. Keeper runs a real cycle end-to-end → repeat for ≥3 cycles + outage + config-drift drills.
