# Builder note — fresh deposit sits on the shortfall-mode boundary (testnet observation)

**Date:** 2026-06-23. **Found:** M8 testnet soak, first real deposit. **Severity:** review before mainnet (potential launch UX blocker). Not blocking the soak.
**Relates to:** ADR-0036 §7.1 (shortfall mode), ADR-0038 (valuation basis discussion), `PrizeVaultV5.SOLVENCY_TOLERANCE_BPS = 10`.

## Observation (live numbers)
A single fresh **5.0 MON** deposit into `PrizeVaultV5` (testnet `0x97D9CA…`) immediately read back as:
- `totalParticipantPrincipal` = **5.000000** MON
- `strategy.totalAssets` = **4.995010** MON  (≈ **99.900%** backing)

The ~0.1% shortfall is the real testnet shMON's deposit→value rounding/spread (shMON share price ≈ 11.15 MON/share; `deposit` mints shares rounded down, so assets-back < assets-in).

## Why it matters
Shortfall mode triggers when `totalAssets < totalPrincipal × (1 − tolerance)`, tolerance = 10 bps:
- threshold = `5.0 × 0.999` = **4.995000** MON
- actual = **4.995010** MON

The healthy, just-deposited vault is **above the line by ~0.00001 MON** — it sits *on* the boundary. A marginally larger deposit spread, a different share-price, or accumulated rounding across deposits could push a perfectly healthy vault **into shortfall mode on deposit**, which halts deposits/draws and applies a pro-rata withdrawal haircut. That would be a bad launch UX and a potential blocker.

## Recommendation (builder, before mainnet)
- Review whether `SOLVENCY_TOLERANCE_BPS` (10) is wide enough to absorb ERC-4626 deposit rounding on real shMON, or whether the solvency check should measure on a basis that doesn't penalize the just-deposited round's rounding (e.g. compare realizable value, or widen tolerance with rationale).
- Tie this to the ADR-0038 / §7.1 valuation decision (gross `convertToAssets` vs realizable). The operator confirmed shMON has no exit *fee*, but ERC-4626 rounding still produces a sub-1.0 backing ratio on deposit — that's the gap this note flags.
- Add a test: deposit N, assert the vault does NOT enter shortfall purely from deposit rounding at the launch share-price.

## Soak note
Not blocking M8. Yield for the soak is being simulated by donating native MON to the strategy (design absorbs donations as yield); the M9 mainnet gate uses real shMON yield.
