# ADR-0048 - V5 External Audit System Remediation

**Status:** Accepted for pre-mainnet remediation
**Date:** 2026-08-28
**Amends:** ADR-0036, ADR-0047
**Responds to:** M-01, M-02, M-03, M-04, M-06, and M-07 in `tasks/v5-external-audit-remediation-retest-report-2026-08-27.md`

## Context

The post-remediation audit closed all High and Low findings but left six Medium findings across the
V5 contracts, root construction, indexer, keeper monitoring, and release supply chain. These layers
form one security boundary: correct contracts are insufficient if roots are misclassified, derived
state crosses deployments, canonical history is not checked, a keeper can die silently, or release
inputs can move between review and build.

## Decision

### V5 deployments are explicit indexer domains

The indexer receives a chain ID and an explicit list of V5 tuples
`(vault, drawManager, claimManager)`. Each tuple is derived independently. Draw windows, positions,
winners, points, and history are keyed and joined only within that tuple. Configuration rejects zero
confirmations, chain mismatches, missing pool addresses, duplicate roles, and a single address used
for multiple roles.

### Claim leaves carry an explicit role

Claim leaves advance to version 3 and include `ClaimKind`: `Winner`, `Fee`, or `Reward`.
The draw algorithm advances to version 3 in both independent implementations. Only Winner leaves
may auto-compound or produce winner/history/points attribution. Fee and reward payments remain
claimable but cannot be interpreted as wins. This supersedes ADR-0047's version-2 leaf definition.

### Indexed state follows the canonical chain

The indexer uses a nonzero confirmation depth, stores canonical block hashes with its cursor, and
checks the cursor before each sync. On divergence it rewinds to a known ancestor, deletes orphan raw
events, and deterministically rebuilds all derived data. Health reports the confirmed head,
canonical cursor hash, and rewind count.

### Reward schedule mutation is contract-wide nonreentrant

One lock protects funding and cancellation across native MON and every reward token. The active
schedule cap is checked while the lock is held, so same-token, cross-token, native, and chained token
callbacks cannot interleave schedule mutation or exceed the cap.

### Release inputs are immutable and auditable

Production lockfiles are committed. Wallet integration uses pinned Reown AppKit packages instead of
deprecated Web3Modal; the vulnerable transitive Axios line is overridden to patched version 1.18.0.
Known critical `@xmldom/xmldom` build exposure is overridden to 0.9.12. GitHub Actions use full
commit SHAs and container bases use image digests. CI emits CycloneDX SBOMs, lockfile hashes, runtime
versions, a vulnerability scan, and a git-SHA-named immutable artifact.

Residual deprecated transitive packages that cannot be removed without replacing their maintained
parent are disclosed by dependency path and runtime reachability in release evidence. They are not
treated as silent acceptance and remain subject to the release vulnerability scan.

### A success heartbeat is mandatory

A managed V5 keeper refuses to start without an external success heartbeat URL. Actionable failures
attempt Telegram and the failure endpoint. If both alert transports fail, the supervisor exits so
the independently hosted success heartbeat expires. Terminal quarantined claims remain nonfatal and
do not flap the dead-man check.

## External dependencies and failure behavior

- **Monad RPC:** transient errors are retried; confirmed indexing and canonical hash checks prevent a
  reorg from becoming permanent derived state. Persistent loss stops progress and expires heartbeat.
- **Pyth Entropy:** unchanged from ADR-0047; oracle failure stalls draws but not principal exits.
- **shMON:** unchanged from ADR-0045; it remains the payout and strategy share token.
- **Reward ERC-20s:** malicious callbacks are contained by the contract-wide mutation lock.
- **Reown/WalletConnect:** connector failure affects wallet access only, not custody. Exact direct
  versions and transitive security overrides are locked.
- **npm, GitHub Actions, and container registries:** builds consume locks, full action SHAs, and image
  digests; SBOM/provenance artifacts make reviewed inputs reproducible.
- **Fly, Telegram, and the dead-man provider:** no one transport is sufficient. Loss of both active
  alert routes forces process exit so the external deadline detects the outage.
- **Indexer database volume:** corruption or canonical divergence triggers deterministic rebuild from
  finalized raw logs; health exposes rewind state.

## Consequences

- Version-2 roots are incompatible with the new ClaimManager and winner tooling. A fresh UAT stack
  and end-to-end draw/root/claim retest are required before mainnet.
- Indexer deployments must set `INDEXER_CHAIN_ID`, positive `INDEXER_CONFIRMATIONS`, and
  `V5_DEPLOYMENTS_JSON`; ambiguous legacy configuration fails closed.
- Mainnet keeper deployment requires the external success URL before the process can start.
- Release CI may block on a fixed High or Critical dependency advisory and emits reviewable SBOM and
  scan artifacts for every staging commit.
