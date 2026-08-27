# V5 external-audit contract remediation evidence

**ADR:** ADR-0047  
**Date:** 2026-08-27  
**Scope:** M-04, M-05, L-01, L-02, L-03, L-04

## Finding closure

| Finding | Remediation | Regression evidence |
| --- | --- | --- |
| M-04 | 16-entry active reward-schedule set with O(1) removal, 365-draw cap, per-token minimum | cap+1 rejection, cancellation slot reuse, expiry-at-cap gas test |
| M-05 | seed-receipt grace plus guardian/owner-authorized fallback set | delayed-seed test, unauthorized fallback rejection, guardian veto and revocation recovery |
| L-01 | leaf domain v2 binds version, chain ID, and ClaimManager | Solidity leaf-shape test, cross-chain/manager root tests, JS/Python parity |
| L-02 | isolated optional-Boolean token-call boundary | revert, false, malformed, noncanonical, and no-return token tests |
| L-03 | authenticated stale callback is emitted and ignored | current, stale, wrong-provider, and callback-gas tests |
| L-04 | raw MON rejected except authorized ClaimManager escrow | Vault, DrawManager, Strategy, and ClaimManager receive tests |

## Local verification

- Full `forge test -q`: pass.
- `npm run build`: pass.
- `npm run check:abi`: pass.
- `npm run check:deploy-source`: pass.
- `npm run draw:watch:test`: 15 pass.
- `npm run draw:fuzz`: 1,000 JS/Python parity cases pass.
- `npm run draw:load100k`: pass; four leaves, JS 4.154s, Python 0.601s.
- `npm run keeper:v5:test`: 16 pass.
- Maximum deployed V5 bytecode in this change: DrawManagerV5 19,255 bytes, 5,321 bytes below the limit.

No live-network transaction or secret access was performed. A fresh UAT stack is required because
algorithm v2 roots are intentionally incompatible with the current UAT ClaimManager. UAT must prove
a live Entropy callback, root proposal/finalization, and claim before mainnet deployment.
