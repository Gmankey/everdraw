# Builder note — keeper off-chain prediction fragility (root cause of 3 soak bugs)

**Date:** 2026-06-23. **Severity:** robustness; fix properly before mainnet. **Found:** M8 live soak.

## Pattern
Three separate keeper crashes in the soak, all the same root cause: the keeper tries to **predict** what `DrawManagerV5.startDraw()` will do (skip vs real draw, and the required oracle fee) by re-deriving the contract's logic off-chain. That off-chain derivation disagrees with the on-chain computation at boundaries, and the keeper crashed each time:
1. **Empty period** — off-chain `getTotalTwabBetween` reverts (no observations) → keeper crashed. (PR #134: tolerate → skip.)
2. **TWAB not finalized** — period still in the overwrite window → revert → crashed. (PR #136: detect → defer/retry.)
3. **Insufficient oracle fee** — keeper predicted "skip" (or under-funded the dynamic Pyth fee) and sent too little → revert → crashed. (this PR: self-correct → retry with buffered fee.)

Each fix is a patch on the symptom. The **root cause is that the keeper mirrors contract logic off-chain and the two can diverge.**

## Recommended proper fix (builder, before mainnet)
Add a **single on-chain view that tells the keeper exactly what `startDraw` will do**, so the keeper stops guessing:

```solidity
function previewStartDraw() external view
    returns (bool due, bool willSkip, uint256 requiredFee);
```
- `due` = period ended.
- `willSkip` = totalTwab == 0 || availablePrize < minPrizeThreshold (the exact on-chain skip conditions).
- `requiredFee` = 0 if willSkip, else `randomnessOracle.getFee()`.

The keeper then: if `!due` → wait; if `due && willSkip` → `startDraw{value:0}`; if `due && !willSkip` → `startDraw{value: requiredFee (+ small buffer)}`. No off-chain re-derivation, no boundary disagreement, no crash class.

Until that ships, the keeper carries the three defensive patches (tolerate-empty, defer-not-finalized, retry-on-insufficient-fee + fee buffer), which are correct but are belt-and-suspenders around the missing view.

## Also
- Add keeper regression tests for all three revert paths (currently none — they were only caught live).
- The deposit→draw boundary timing (deposit must sit a full period; first finalized period lags) is worth documenting in the draw-ops runbook so soak operators know what to expect.
