# V5 TWAB — testnet soak result (2026-06-26)

**Owner:** PM. **Verdict:** TWAB-1/2/3 **verified on Monad testnet (chain 10143).** Closes the TWAB closure ticket (#150) and its follow-ups (#152, #155). The V5 soak un-pause gate (phantom-TWAB) is cleared.

## Deployment under test (aligned redeploy)
Deployed from `staging` @ `a4f7c79` with the fixed `deploy-v5-testnet.js` (fast-soak profile rejected — `TWAB_PERIOD_LENGTH_SEC` floored at the contract minimum of 3600; final profile 3600/3600).

| Contract | Address |
|---|---|
| EverdrawTwabController | `0x75371C0485c0BE936fdF97Be8eAabc4F97Bb5CD5` |
| ShmonStrategy | `0x2d22FEe3853BA5A619055945C844eD507A63928D` |
| PrizeVaultV5 | `0x6b37f99486c9fbF37c20e22C0A14A66A527d00f3` |
| ClaimManagerV5 | `0x1AA4C0C9961ACB61d2B8573E5B71528fF42e287d` |
| PythRandomnessOracle | `0x48ce8baBE540C090ddbeB82B90cb8349F0d071B6` |
| DrawManagerV5 | `0x597Acf8654E5e988c78F076450DD94f3a75C456E` |

Start block 40631160. Guardian/deployer `0xd5cc…3431`, keeper `0x629B…1268`.

## Alignment (TWAB-D / TWAB-1 root cause) — VERIFIED
- DrawManager deployed **without reverting** → passed the new `BadTwabPeriodAlignment` constructor guard.
- On-chain: `periodLength=3600`, `(firstPeriodStart − periodOffset) % periodLength = 0`, `drawPeriod % periodLength = 0`. **Aligned.**
- The draw-11 deploy-side cause (`firstPeriodStart = offset + 300`, off-grid) is structurally impossible now — the script snaps/asserts and the contract guard rejects misalignment.

## Draw 1 — TWAB-1 (no phantom) + TWAB-3 (skip + one-slot advance) — VERIFIED
Period 0 had a single 5 MON participant deposit (`0xd5cc`, mid-period). `startDraw` recorded draw 1:
- `periodStart/periodEnd = 1782449185 / 1782452785` — **exactly** TWAB period 0's `[start,end)`. The draw-11 failure (measuring past the stored period into a later deposit) does **not** occur.
- `totalTwab = 3.316 MON` — matches an independent `getTotalTwabBetween` read. **No phantom mass, no mismatch.**
- `status = Skipped (ZERO_PRIZE)` — correctly distinguished a funded-but-no-yield period (`availableYield = 0`; `strategy.totalAssets 4.9979 ≤ totalPrincipal 5`, the expected shMON ERC-4626 rounding) from an empty one. No VRF spend.
- `nextPeriodStart` advanced by **exactly one** `drawPeriod` (3600s).

## Transfer — TWAB-2 (transferable share) — VERIFIED
Transferred 2 MON of position `0xd5cc → 0x629B` via `vault.transfer`:
- `principalOf` 3 / 2; `totalSupply` and `totalParticipantPrincipal` stayed **5** (conserved).
- TWAB `balanceOf` 3 / 2 (both parties updated atomically); participant & principal supply stayed 5.
- Sponsor delegate TWAB stayed **0** (no leakage into/through the sponsor surface).

## What this proves vs. what it doesn't
- **Proven (TWAB scope):** grid alignment, no phantom TWAB, correct period boundaries, skip + exact one-slot advance, transferable-share TWAB accounting with supply conservation and sponsor exclusion — live, plus 86 passing forge tests incl. the `twabMatchesVaultLedger` invariant (5000 runs / 250k calls).
- **Not exercised live:** a full *paying* draw (seed → proposeRoot → finalize → claim with a winner). This path is untouched by the TWAB fixes, is unit-tested in `DrawManagerV5.t.sol` (17 tests), and is gated on the keeper + injected yield. It is **not a TWAB concern** — see the keeper-reliability ticket.

## Open item (not TWAB)
The local keeper (`scripts/keeper-v5.js`) **hung on public testnet RPC** during the soak (no output, zero txs broadcast) and carries a `getTotalTwabBetween` ABI mismatch. `startDraw` was driven manually (permissionless) to record draw 1. Keeper hardening is tracked in `tasks/v5-keeper-reliability-builder-ticket.md` (backlog P1-2/P1-3). This is operational tooling, not a protocol/TWAB defect.
