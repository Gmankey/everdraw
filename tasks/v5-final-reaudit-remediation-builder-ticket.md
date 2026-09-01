# EverDraw V5 Final Re-audit Remediation

**ADR:** ADR-0048
**Audit:** `tasks/v5-external-audit-final-retest-report-2026-08-31.md`
**Target:** close M-01, M-03, M-06, N-01, and N-02 before another immutable re-audit.

## Required outcomes

- Managed V5 indexers fail startup for absent, empty, duplicate, malformed, cross-chain, or incorrectly wired deployment tuples. Health exposes the active tuples.
- Indexer, independent watcher, and watcher-input cache verify logs against canonical block hashes and atomically checkpoint only a fully verified range. In-flight reorgs force a clean retry without persisting orphan data.
- Root and frontend locked build trees contain no fixed Critical or High advisories under npm and release-SBOM scanning.
- Mainnet builds reject missing or placeholder WalletConnect project IDs.
- Browser claim recovery verifies the complete domain, leaf, Merkle proof, and simulation before sending. Proof publication is append/versioned and anchored to the finalized on-chain root.

## External dependencies

- Monad RPC can reorg or return inconsistent logs/blocks: verified ranges are discarded and retried; no cursor advances.
- npm/advisory databases can be unavailable or disagree: both npm and archived SBOM scanner results are required.
- Reown/WalletConnect configuration failure blocks mainnet build.
- Claim-proof publisher/storage compromise cannot bypass browser verification against the live ClaimManager root.

## Acceptance

Implement the auditor's adversarial fixtures, run the complete Forge/indexer/watcher/frontend/docs suites, run the Cancun real-shMON fork gate, archive dependency evidence, and produce one immutable remediation report for re-audit.
