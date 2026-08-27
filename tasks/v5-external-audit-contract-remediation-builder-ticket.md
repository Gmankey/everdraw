# V5 external-audit contract remediation builder ticket

**ADR:** ADR-0047
**Audit:** `tasks/v5-external-audit-report-2026-08-26.md`
**Findings:** M-04, M-05, L-01, L-02, L-03, L-04
**Base:** `staging`

## Required implementation

1. Replace historical reward scans with a bounded active set. Enforce caps and per-token minimums.
   Test cap filling, cap+1 rejection, cancellation, expiry, and start-draw gas at the cap.
2. Measure fallback grace from seed receipt and reject non-primary proposers unless they are the
   guardian or owner-authorized fallback. Test delayed seeds, grace, veto, and repeated grief.
3. Bind leaf v2 to version, chain ID, and ClaimManager. Update Solidity, JS, Python, fixtures, and
   watcher/keeper inputs. Prove cross-chain and cross-manager roots fail.
4. Treat only empty or canonical true ERC-20 return data as success inside a rollback boundary.
   Test false, malformed lengths, noncanonical Boolean, revert, and no-return success.
5. Keep Entropy V1 but catch authenticated stale/consumer-rejected callbacks with an event. Test
   current delivery, stale delivery, wrong provider, and callback gas.
6. Reject unintended native sends to Vault, DrawManager, and Strategy. ClaimManager accepts native
   escrow only from authorized sources and emits it. Preserve intended payable functions.

## Gates

- Focused tests fail before and pass after the fix.
- JS/Python parity and keeper/watcher suites pass.
- ABI freshness, source-manifest, Hardhat compile, and full Forge suite pass.
- Mainnet EVM target remains `paris`; fork profile remains `cancun`.
- No live-network action and no secret access.

