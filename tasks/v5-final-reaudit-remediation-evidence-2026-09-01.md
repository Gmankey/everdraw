# EverDraw V5 final re-audit remediation evidence

Date: 2026-09-01  
Base: `origin/staging` at `b0a30b5`  
Decision record: `decisions/0048-v5-external-audit-system-remediation.md`  
Audit input: `tasks/v5-external-audit-final-retest-report-2026-08-31.md`

## Scope

This change addresses every code finding left open by the 2026-08-31 external re-audit:
M-01, M-03, M-06, N-01, and N-02. It does not change V5 Solidity or compiler
configuration and does not deploy to UAT or mainnet.

## Finding evidence

### M-01 - fail-closed indexer deployment binding

- `V5_DEPLOYMENTS_JSON` is mandatory and rejects empty, malformed, duplicate, ambiguous,
  wrong-chain, or pool-inconsistent tuples.
- `CLAIM_PROOF_INGEST_SECRET` is mandatory and must contain at least 32 characters.
- Startup verifies the complete live tuple before serving:
  `vault.drawManager == manager`, `manager.vault == vault`,
  `manager.claimManager == claimManager`, and
  `claimManager.authorizedSource(manager) == true`.
- Health output exposes the active deployment tuples.
- UAT and mainnet Fly/runbook configuration names all mandatory secrets.
- Negative and live-wiring fixtures are in
  `scripts/indexer/src/runner/config.test.ts` and
  `scripts/indexer/src/runner/deploymentWiring.test.ts`.

### M-03 - in-flight reorg atomicity

- The indexer captures canonical boundary hashes before fetching, validates every returned
  log's `blockHash`, rechecks the boundaries, then atomically commits raw rows, canonical
  history, and the cursor in one database transaction.
- The watcher applies the same before/fetch/per-log/after validation and stages cache
  mutations until canonicality is proven.
- An adversarial chain-A-log/chain-B-checkpoint test proves an in-flight reorg persists no
  orphan rows, advances no cursor, and retries cleanly on chain B.
- Watcher cache tests prove a rejected range does not create or advance the cache file.

### M-06 - fixed dependency vulnerabilities

- Root fixed all High/Critical advisories while retaining Hardhat 2 and the Paris deploy
  target. Nine Low advisories remain through the legacy ethers v5/elliptic path; eliminating
  them requires the separately reviewed Hardhat 3 migration.
- Indexer: zero known vulnerabilities.
- Frontend: zero known vulnerabilities.
- Docs: zero known vulnerabilities.
- No production contract source, `foundry.toml`, or Hardhat compiler configuration differs
  from the staging base.

### N-01 - production wallet configuration

- Production chain 143 rejects a missing, demo, placeholder, or replacement Reown project ID.
- Testnet/development fallback behavior remains available.
- The production release-config preflight enforces the same rule.

### N-02 - proof provenance and browser verification

- Proof publication is authenticated, append-only, and idempotent; altered historical
  payloads are rejected.
- The indexer accepts proofs only after the ClaimManager has a registered finalized
  distribution whose source, draw ID, Merkle root, and leaf count exactly match.
- The watcher still recomputes proposed roots during the veto window. It independently
  reconstructs the finalized draw before publishing proofs; publication failure pins the
  finalized event for retry.
- The browser verifies chain, active vault/manager/claim-manager tuple, wallet, distribution
  ID, v3 leaf hash, sorted Merkle proof, finalized on-chain distribution, leaf index, and
  unclaimed status, then simulates `claimMany` before sending.
- Tampered amount, root, deployment, and historical-republication fixtures reject.

## Verification

- Solidity: `forge test` -> **337 passed, 0 failed, 1 skipped** across 52 suites.
  The skip is the real-shMON fork test requiring the operator archive RPC.
- Watcher/draw JavaScript: **20 passed**.
- Indexer TypeScript tests: **17 passed**; TypeScript build passed.
- Frontend tests: **38 passed**; production build passed.
- Root JavaScript tests passed.
- Hardhat compile passed with **Paris** EVM target.
- ABI freshness and production source manifest checks passed.
- `npm audit --audit-level=high`: root/indexer/frontend/docs all exit 0.
- `npm audit`: indexer/frontend/docs report 0; root reports 9 Low only.
- `git diff --check`: passed.
- Contract/config guard:
  `git diff --exit-code origin/staging -- src foundry.toml hardhat.config.js hardhat.config.cjs`
  passed.

## Remaining release gates

These are operational or independent-verification gates, not unfinished remediation code:

1. External auditor retests M-01, M-03, M-06, N-01, and N-02 against the PR commit.
2. Operator runs `test/v5/PrizeVaultV5Fork.t.sol` with the archive Monad mainnet RPC and
   `--evm-version cancun`; expected result is 6/6.
3. Deploy a fresh UAT stack from the accepted commit and configure the exact tuple plus
   proof-ingest credential.
4. Observe a real proposed-root match, finalized proof publication, browser claim
   verification, and successful `claimMany` on UAT.
5. Mainnet remains NO-GO until the auditor and operator sign off those gates.
