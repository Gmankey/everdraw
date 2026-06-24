# Soak finding — phantom TWAB on an empty period (draw 11) — POSSIBLE CONTRACT BUG

**Date:** 2026-06-24. **Severity:** HIGH — possible TWAB-accounting correctness bug; potential launch-blocker. Needs builder/contract investigation (NOT keeper plumbing).
**Where:** V5 M8 testnet soak, DrawManager `0x266ab124…`, vault `0x97D9CA6D…`, TwabController `0xa8C05BAC…`.

## Observation
- `draws(11)` on-chain: `periodStart=1782258805`, `periodEnd=1782262405`, `status=Seeded`, **`totalTwab=2.994444…`**, `totalPayout=0.995988 MON`.
- A **full-history** Deposit-event scan of the vault (deploy block → seed block) finds **exactly ONE deposit in the vault's entire life**: ~5 MON by `0x47331C…`, at block ~40183198, **timestamp 1782263165**.
- `1782263165` is **760s AFTER** draw 11's period ended (`1782262405`) → it falls in **period 12**, not period 11.
- `getTwabBetween(0x47331C, period11)` **reverts `InsufficientHistory`** — that account had no balance during period 11 (its first observation is later). Correct.
- Net: **no account had any balance during draw 11's period, yet the contract minted a real (non-skip) draw with totalTwab 2.994 and a 0.996 MON prize.**

## Why this matters
- The off-chain winner builder correctly computes account-sum TWAB = 0 for period 11, which **contradicts** the contract's stored `totalTwab=2.994`. (This is why the keeper's TWAB-mismatch guard fires — the guard is doing its job.)
- A draw on a period with zero participant balance should **skip** (ADR-0036 §3.4 zero-TWAB skip). Instead it became a real draw with a prize. That implies either:
  1. **TwabController bug:** a deposit in period 12 is polluting period 11's `getTotalTwabBetween` (e.g., extrapolation / observation-boundary error) — a real correctness bug in the central TWAB component, exactly what the M1 differential test vs PoolTogether was meant to catch; OR
  2. **Draw/period boundary bug:** the draw's stored period doesn't match the period whose TWAB was actually measured; OR
  3. An unobserved deposit/sponsor interaction the scan didn't capture (less likely — full-history scan found only the one deposit).
- Any of these means winner **odds/prizes can be wrong**, including phantom prizes on empty periods. Launch-blocker until explained.

## Builder investigation checklist
- [ ] Reproduce: call `twabController.getTotalTwabBetween(vault, 1782258805, 1782262405)` and confirm it returns 2.994 with only the period-12 deposit present.
- [ ] Inspect TwabController observations for the vault: timestamps, cumulative balances, the overwrite-period handling around the period-11/12 boundary.
- [ ] Check whether a deposit's observation is being attributed to / extrapolated into the prior period.
- [ ] Cross-check against the PoolTogether reference (M1 differential harness) for this exact observation pattern (single deposit, query a prior period).
- [ ] Confirm whether draw 11's `startDraw` measured period 11 or a shifted period.

## Status of the keeper plumbing (separate, FIXED this session)
The keeper input-builder (`scripts/draw/write-watch-inputs.mjs`) now works end-to-end (~80s/build) after fixing: log pagination + adaptive range bisect, transient-error retry, dual-RPC (tenderly for logs / official for calls), the **broken SeedReceived filter** (was a DeferredTopicFilter that dropped topics and fetched every chain log → 25k logs/window → hangs), sequential concurrency for tenderly, and per-account `InsufficientHistory` tolerance. Those are real fixes and are landed. The phantom-TWAB finding above is independent and is a contract-level issue.
