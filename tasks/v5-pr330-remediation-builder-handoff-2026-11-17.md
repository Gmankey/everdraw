# PR #330 remediation builder handoff

Date: 2026-11-17 (Australia/Sydney)
Prior audited head: `6532e59d16339cb4cb81e586ac8dd4ce8820a98b`
Status: superseded by `tasks/v5-pr330-r330-08-09-remediation-handoff-2026-11-18.md` after the 2026-11-18 re-audit identified R330-08 and R330-09.

## Operational state

- Mainnet keeper remains stopped.
- Mainnet watcher remains disabled.
- No live provider qualification was run.
- No service, secret, paid-provider request or production configuration changed.

## Finding closure

### R330-01 HIGH - authenticated gateway

Keeper and Hardhat now use scoped bearer headers. Mainnet keeper requires the exact approved gateway route/host and validates auth plus chain ID before lifecycle reads. Failures enter the persistent stop class. Integration tests exercise the actual keeper provider through the actual gateway to a fake upstream for chain ID, nonce, gas, send and receipt polling, plus wrong-token rejection.

### R330-02 HIGH - bounded catch-up

A shared cumulative budget covers discovery, independent reconstruction, canonical checks, historical reads and retries. Bootstrap/reorg reset requires admission and persists each completed chunk. Scheduled and manual workflows are separate/mutually exclusive. The canary checks out only fixed trusted `staging` with credentials disabled, requires its head to equal the approved immutable commit, namespaces progress by that commit, and invokes the watcher once with 250,000 block-work and 5,000 request ceilings.

### R330-03 HIGH gate - exact qualification

Qualification requires reviewed nonempty seed/proposal/finalization/mint/transfer/burn identities and receipts, pins all providers to chain 143 and one final canonical block, compares complete history/boundaries/participants, and reconstructs historical TWAB, prize legs and Merkle roots through candidate and reference. It is manual, approved, admitted, capped and incrementally evidenced.

### R330-04 MEDIUM - corrupt state

Strict invariants reject unsafe counters, roles, totals, reservations, caps and latch/config state. Writes fsync temporary state, rename atomically and fsync the parent.

### R330-05 MEDIUM - admin race

Reservations and admin mutations share one lock. Same-period reset and redundant unlatch are rejected. Multiprocess tests prove no lost update.

### R330-06 MEDIUM - qualification spend

Live qualification was removed from PR CI. The manual workflow checks out only fixed trusted `staging` with credentials disabled and requires its head to equal the approved SHA. It has environment approval, immutable inputs, shared provider-period admission, cooldown, run ceiling, incremental artifact and always-persisted admission state.

### R330-07 MEDIUM - HTTP boundary

Redirects are denied, timeout covers the complete body and response size is bounded, with regressions for each.

### SBOM

Patched body-parser, follow-redirects, Next.js, DOMPurify, Zod, Hono server/qs, Vite/transitives and KaTeX/minimatch/transitives. Indexer, web and docs each report zero npm vulnerabilities. Root reports nine low Hardhat 2 development-tool advisories; npm offers only a breaking Hardhat 3 migration, so they are disclosed rather than force-migrated here.

## Verification

| Check | Result |
|---|---:|
| RPC/gateway/qualification | 17 passed |
| Watcher/cache/reorg/participants | 44 passed |
| Keeper/deployment/supervisor | 27 passed |
| Indexer | 34 passed |
| Indexer TypeScript | passed |
| Web production build + secret scan | passed |
| Docs production build | passed |
| Indexer/web/docs npm audit | 0 vulnerabilities each |

No live-chain qualification is included. It remains behind approval of the exact evidence and request admission values.

## Limits to review

- Scheduled watcher: 20,000 cumulative block-work / 1,500 wire requests.
- Manual canary: 250,000 cumulative block-work / 5,000 wire requests.
- Qualification: 10,000 requests/run plus shared period cap and 24-hour cooldown.
- Gateway: 15M CU account ceiling, 4M protected reserve, 8M keeper-write, 3M deployment, 2M CI fork.

## Requested re-audit

1. Re-run the test/build matrix from the immutable commit.
2. Re-run the prior loopback defect fixture and confirm R330-01 through R330-07 are absent.
3. Inspect workflow exclusion, one-shot behavior and actual-wire accounting.
4. Approve the qualification evidence schema before any live run.
5. Review single-machine/single-volume operation and stale-lease recovery.
6. Confirm keeper remains stopped and watcher remains disabled pending separate approvals.

Final immutable remediation commit: use the exact SHA in the PR handoff comment and verify it with `git rev-parse HEAD` after checkout.
