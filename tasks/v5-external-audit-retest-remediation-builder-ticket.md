# V5 External Audit Retest Remediation Builder Ticket

**ADR:** ADR-0048
**Source:** `tasks/v5-external-audit-remediation-retest-report-2026-08-27.md`
**Base:** `staging`
**Network work:** none; code and local tests only

## Scope

Close the six Medium findings left by the 2026-08-27 external retest.

1. M-01: derive every configured V5 vault/manager/claim-manager stack independently and reject
   ambiguous roles.
2. M-02: add an explicit claim kind to the leaf domain and prevent fee/reward claims from becoming
   winner history or points.
3. M-03: add confirmed canonical cursors, hash verification, deterministic rewind, orphan deletion,
   rebuild, and health evidence to the indexer.
4. M-04: protect all reward schedule mutation with one contract-level reentrancy lock.
5. M-06: replace deprecated wallet integration, resolve direct peer constraints, commit every
   production lock, pin Actions/images, and emit scanned SBOM/provenance artifacts.
6. M-07: require the external keeper success heartbeat and fail closed when actionable alert
   delivery has no working route.

## Acceptance

- Two overlapping deployments with the same draw ID and wallet remain isolated for tranches,
  entries, points, winners, and history.
- Fee, reward, multi-winner, deferred winner, paid winner, and auto-compound fixtures never create
  false winner attribution.
- Shallow and deep reorg fixtures replace every V5 lifecycle and position event without stale rows.
- Same-token, cross-token, native, and chained callback tokens cannot exceed 16 active schedules;
  worst-case finalization remains within its gas budget.
- Keeper tests prove success URL startup enforcement, nonfatal quarantine behavior, actionable
  failure routing, and process termination when both active alert routes fail.
- Solidity, indexer, keeper/watcher, JS/Python differential, frontend, and docs checks pass.
- Release workflow creates lock hashes, CycloneDX SBOMs, vulnerability scan output, provenance, and
  a git-SHA-named artifact.
- No secrets and no live-network transactions are used.
