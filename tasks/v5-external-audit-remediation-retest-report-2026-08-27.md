# EverDraw V5 External Audit Remediation Retest

- **Retest date:** 27 August 2026
- **Original audited commit:** `089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b`
- **Merged staging commit:** `056ff47a172faba1af133ca774ef4328d8dac294`
- **Tested worktree commit:** `567026a3b760d66c84ca5fb403740b2cc846b83d`
- **Tree hash:** `44c2f872db6dcd5c73f37860fcc6b0811e31077c` for both merged and tested commits
- **Remediation PRs:** [#273](https://github.com/Gmankey/everdraw/pull/273), [#274](https://github.com/Gmankey/everdraw/pull/274), [#275](https://github.com/Gmankey/everdraw/pull/275), [#276](https://github.com/Gmankey/everdraw/pull/276), [#277](https://github.com/Gmankey/everdraw/pull/277), [#278](https://github.com/Gmankey/everdraw/pull/278)
- **Status:** Final retest — further remediation required

> **Private disclosure.** This report includes an unremediated cap-bypass path and operational weaknesses. Keep it within the remediation and launch-approval group until the open findings are resolved.

## 1. Retest verdict

The remediation materially improves EverDraw V5. All five original High findings are **closed in code**, and all four original Low findings are **closed in code**. The keeper/watcher transfer reconstruction, mainnet deployment resolution, frontend fail-closed configuration, and final ownership lifecycle have credible regression coverage.

The release is nevertheless **not ready for mainnet**. Six Medium findings remain open:

- M-01: indexer transfer ingestion was added, but multi-vault/manager derivation remains unsafe;
- M-02: fee/reward `ClaimPaid` events are still classified as winner claims;
- M-03: watcher reorg recovery was added, but the indexer remains noncanonical and defaults to zero confirmations;
- M-04: the new 16-schedule cap is bypassable through cross-token reentrancy;
- M-06: vulnerable/deprecated dependencies and unpinned release inputs remain; and
- M-07: keeper monitoring still lacks a required external success heartbeat.

The appropriate release decision is:

- **Fresh UAT:** GO, specifically to exercise algorithm-v2 deployment, live Entropy, root, claim, transfer, reorg, and monitoring drills.
- **Mainnet deployment/deposits:** **NO-GO** until the open Medium findings and operational launch gates in this report are closed.

No new Critical or High finding was confirmed during the retest.

## 2. Finding status matrix

| ID | Original finding | Retest status | Result |
|---|---|---|---|
| H-01 | Owner can shorten active challenge | Closed in code | Per-proposal deadline, mainnet minimum, timing timelock, watcher check |
| H-02 | Transfers break keeper/watcher | Closed in code | Transfer-complete independent reconstruction and reorg tests |
| H-03 | Mainnet keeper/watcher absent | Code closed; live proof pending | Strict active-manifest resolver and mainnet watcher workflow added |
| H-04 | Frontend testnet/mixed-chain fail-open | Closed in code | Complete manifest and runtime/write preconditions fail closed |
| H-05 | Deployer retains all ownership | Code closed; live proof pending | Four-contract two-step handoff and accepted-owner activation gate |
| M-01 | Indexer transfer/vault contamination | **Partially fixed; open** | Transfer added; derivation still combines vaults/managers |
| M-02 | Fee claim classified as winner | **Open** | Affected code is unchanged |
| M-03 | Indexer/watcher reorg unsafe | **Partially fixed; open** | Watcher fixed; indexer not fixed |
| M-04 | Unbounded reward processing | **Open — retest failed** | Active set added, but cap is reentrancy-bypassable |
| M-05 | Permissionless proposal grief | Closed in code | Grace begins at seed receipt and fallback is permissioned |
| M-06 | Dependency/supply-chain exposure | **Open** | Locks unchanged; actions/images still mutable |
| M-07 | Keeper dead-machine blind spot | **Open** | Mainnet configuration still provides failure URL only |
| L-01 | Claim replay domain incomplete | Closed in code | V2 leaf binds chain, ClaimManager, and version |
| L-02 | Malformed token return can revert claim | Closed in code | Isolated canonical optional-Boolean calls |
| L-03 | Stale Entropy callback reverts | Closed in code | Authenticated stale callbacks are fail-soft |
| L-04 | Raw MON stranded/confusing | Closed in code | Explicit receive guards and authorized native escrow |

## 3. High-severity closure evidence

### H-01 — Closed

`DrawManagerV5` now stores `challengeEndsAt[drawId]` at proposal and finalizes against the stored deadline. Timing changes are queued for 24 hours, and chain 143 rejects a challenge window below eight hours. Cancellation clears the old deadline; reproposal receives a fresh protected window. The watcher compares the event deadline with the stored value.

The original one-second owner bypass no longer works.

### H-02 — Closed

Keeper account discovery now consumes vault `Transfer` events, including mint, burn, sender, and recipient. It persists chain/vault/block-hash-scoped state and rebuilds on canonical-hash divergence. The watcher uses a separate reconstruction module and the Python winner implementation rather than importing the keeper input builder.

Regression tests cover partial/full transfers, transfer chains, boundary timing, independent keeper/watcher roots, and reorg replacement.

### H-03 — Code closed; operational evidence still required

The keeper resolves a chain-correct V5 record with status `draw-manager-committed`, validates required addresses, rejects runtime overrides, checks bytecode, and verifies contract wiring. `.github/workflows/v5-watcher-mainnet.yml` provides a separately gated chain-143 watcher with distinct RPC, cache, and healthcheck configuration.

This closes the source/configuration defect. Mainnet closure still requires a real activated manifest, manual workflow dispatch, independent catch-up, successful bad-root alert, and guardian Ledger/multisig veto drill before deposits.

### H-04 — Closed

The frontend now consumes one complete versioned release manifest. Mainnet builds reject an absent, malformed, mixed-environment, or mixed-address manifest. Runtime checks verify wallet/RPC chain, nonempty bytecode, manager/vault/strategy/claim/oracle wiring, vault registration, and source authorization. Transaction submission rechecks wallet chain, runtime state, and live data. RPC read failure disables actions instead of becoming a zero balance.

### H-05 — Code closed; operational evidence still required

The deployment script requires distinct deployer, final owner, guardian, keeper, and pauser addresses. It nominates the final owner on TWAB, PrizeVault, ClaimManager, and DrawManager, records four acceptance transactions, verifies final ownership, and refuses DrawManager activation until ownership is accepted. Direct final-owner and multisig-executed activation paths are supported and checked through receipts/events.

Mainnet closure requires execution evidence showing all four accepted owners, zero pending owners, no unintended deployer role, and final-owner DrawManager activation.

## 4. Open Medium findings

## M-01 — Indexer derivation still mixes vault and manager state

**Status:** Partially fixed; remains Medium

`Transfer` ingestion and sender/recipient tranche updates are now implemented with the documented LIFO/fresh-tenure semantics. However, the derivation still reads every finalized raw event together, constructs one global `drawWindows` collection, keys `drawManagerByDrawId` by draw ID only, and groups position activity by `${wallet}:${poolType}` without vault.

Evidence:

- `scripts/indexer/src/services/deriveV5Tranches.ts:57-79`
- `scripts/indexer/src/services/deriveV5Tranches.ts:112`
- `scripts/indexer/src/services/deriveV5Tranches.ts:335-349`
- `scripts/indexer/src/services/deriveV5Tranches.ts:365-410`

With an active and retired V5 stack, or overlapping manager draw IDs/windows, one vault's balances can contribute entries and points to another manager. API response filtering by vault does not repair already contaminated derived data.

**Required fix:** key draw windows, tenure groups, resolved values, and manager lookup by chain + vault + manager + draw. Derive each configured deployment independently and reject ambiguous contract roles.

**Acceptance:** a fixture with two overlapping V5 vaults/managers and identical draw IDs must produce isolated tranches, entries, points, winners, and API results for each stack.

## M-02 — Fee and reward payments still create false winners

**Status:** Open; remediation did not modify the affected code

`deriveRounds.ts:241-245` sets the round winner from every `ClaimPaid`. `deriveWalletRounds.ts:115-122` marks every paid account as `won = 1` and adds its amount to prize claimed. ClaimManager emits the same event for winner, fee, and reward leaves.

The last fee recipient can therefore replace the real displayed winner and receive win-related points. A deferred winner may remain absent while a promptly paid fee recipient is marked as winner.

**Required fix:** emit or persist an explicit leaf role/kind and derive winner identity from finalized winner allocation, not generic payment.

**Acceptance:** tests must cover multiple winners, multiple fee recipients, reward legs, deferred winner payment, fee payment before winner payment, and auto-compounding without false win attribution.

## M-03 — Indexer remains noncanonical across reorgs

**Status:** Watcher fixed; indexer remains Medium

The watcher now stores and verifies a checkpoint block hash and rebuilds on divergence. The indexer still defaults `INDEXER_CONFIRMATIONS` to zero (`runner/config.ts:29`), stores only a numeric cursor, and advances without validating the previous canonical hash (`runner/service.ts:95-140`). Existing rows behind the cursor are never revisited after a reorg.

**Required fix:** require a nonzero production confirmation depth; persist canonical hashes; detect divergence; rewind to a safe ancestor; delete orphan raw/derived rows; and deterministically rebuild all affected rounds, tranches, winners, and points.

**Acceptance:** shallow/deep reorg tests must replace Deposit, Transfer, SeedReceived, RootProposed, RootFinalized, ClaimPaid, and PrizeCompounded events without stale data. Health must report confirmed head, canonical cursor/hash, and rewind count.

## M-04 — Reward-schedule cap is reentrancy-bypassable

**Status:** Open; retest failed

The remediation adds a 16-entry active set, O(1) removal, a 365-draw limit, and per-token economic minimums. The cap is checked at `DrawManagerV5.sol:455-457`, but an external token call occurs at lines 466-469 before the schedule is inserted at 472-482. `fundPrize` has no reentrancy guard.

At 15 active schedules:

1. a call funding allowlisted token A passes the cap check;
2. token A's `transferFrom` reenters `fundPrize` for allowlisted token B;
3. the inner call also sees 15, inserts schedule 16, and returns; and
4. the outer call inserts schedule 17.

A callback chain across allowlisted tokens can exceed the intended bound further. Balance-delta checks do not prevent this cross-token form because each frame measures a different escrow balance.

**Required fix:** make funding/cancellation reentrancy-safe, preferably with one contract-level guard around schedule mutation and external token/native calls. Preserve checks-effects-interactions and the exact active-set invariant.

**Acceptance:** malicious callback-token tests at `MAX_ACTIVE_REWARD_SCHEDULES - 1` must attempt same-token, cross-token, native-token, and chained reentrancy and prove the active count never exceeds 16. Re-run worst-case finalization gas after the fix.

## M-06 — Dependency and build-input exposure remains

**Status:** Open

No production dependency lock changed in PRs #273-#278. Installation still reports deprecated Web3Modal and WalletConnect packages plus a React peer-version conflict. The docs site still lacks a lockfile. GitHub workflows use moving major tags such as `actions/checkout@v4`, and Dockerfiles use mutable `node:20-slim`.

The npm registry audit endpoint was unavailable during this retest, including with unrestricted network access. This prevents a fresh advisory count but does not block the finding: the previously audited dependency graph is unchanged, and mutable/deprecated release inputs remain directly observable.

**Required fix:** upgrade/replace the wallet stack, resolve peer constraints, remove unused runtime dependencies, commit the docs lock, pin Actions to full commit SHAs and images to digests, and produce SBOM/scan/provenance for the release artifact.

## M-07 — Keeper still lacks an external success heartbeat

**Status:** Open

`scripts/keeper/fly.v5.mainnet.toml:9-18,50-52` and `tasks/v5-mainnet-deploy-runbook.md:241-250` configure Telegram and `KEEPER_HEALTHCHECK_FAIL_URL` only. A process that remains alive can report a child failure, but a dead Fly machine cannot send its own failure ping. The keeper supports `KEEPER_HEALTHCHECK_URL`; mainnet configuration still does not require it.

**Required fix:** require a success heartbeat with an external deadline/grace period, independently monitor Fly app/machine state, and monitor alert-delivery failure.

**Acceptance:** process exit, machine kill, RPC loss, network isolation, and failed Telegram/failure endpoint each generate a timely externally observed alert.

## 5. Contract remediation closure

ADR-0047's remaining contract changes were otherwise accepted:

- **M-05:** fallback grace starts at `SeedReceived`; only guardian or owner-authorized fallback proposer may act after grace.
- **L-01:** leaf v2 binds version, chain ID, ClaimManager, distribution, index, account, token, and amount; JS/Python parity passed.
- **L-02:** optional-Boolean calls run in an external self-call rollback frame and accept only empty or canonical 32-byte true.
- **L-03:** wrong-provider callbacks still reject; authenticated stale/consumer-rejected callbacks emit and return without reverting.
- **L-04:** Vault, DrawManager, and Strategy reject raw MON; ClaimManager accepts raw native escrow only from an authorized source.

M-04 is excluded from this closure because its cap invariant failed adversarial review.

## 6. Informational items still open

- **I-01:** frontend lint remains non-clean: 20 errors and one warning.
- **I-02:** V5 claim URL/payload helpers remain unused; no practical self-claim recovery flow is exposed.
- **I-03:** `write-watch-inputs.mjs:181-186` still contains unreachable range-splitting code referencing `err` outside its catch scope.
- **I-04:** documentation/testing improved materially, but winner-role, indexer-reorg, multi-vault, keeper-death, and reward-reentrancy coverage is still missing.
- `git diff --check` also reports trailing whitespace/new blank lines in the new ADR/evidence documents. This is non-security cleanup.

## 7. Independent verification results

| Check | Retest result |
|---|---|
| Exact merged source | `origin/staging` `056ff47`; tree identical to tested `567026a` |
| Full Forge suite | Passed, exit 0 |
| Hardhat compile | Passed |
| ABI freshness | Passed |
| Production deployment-source manifest | Passed |
| Watcher/input tests | 15/15 passed |
| Keeper/deployment/supervisor tests | 16/16 passed |
| Mainnet deployment unit tests | 6/6 passed |
| Draw differential fuzz | 1,000 JS/Python cases passed |
| 100,000-account load/parity | Passed; 4 leaves; JS 17.261s; Python 2.133s |
| Frontend production build | Passed |
| Frontend tests | 30/30 passed |
| Frontend lint | Failed: 20 errors, 1 warning |
| Indexer TypeScript build | Passed |
| Indexer tests | 10/10 passed after rebuilding locked `better-sqlite3` native binding |
| Gitleaks remediation range | Six commits, ~171.37 KB; no leaks |
| Slither | 35 contracts, 245 detector results triaged; M-04 cap bypass confirmed |
| Current npm advisory refresh | Registry audit endpoint unavailable; dependency locks unchanged |

The first frontend `npm ci` attempt ended with npm's `Exit handler never called`; a clean retry from the same lock completed successfully. The first indexer test run intentionally lacked the native SQLite binding because dependencies were installed with `--ignore-scripts`; rebuilding the exact locked module resolved it and all ten suites passed.

## 8. Required builder response

Return one immutable follow-up commit containing:

1. reentrancy-safe reward funding and the cap-bypass regression test;
2. chain/vault/manager/draw-scoped indexer derivation and two-stack fixtures;
3. explicit winner/fee/reward classification and attribution tests;
4. canonical indexer confirmation/rewind/rebuild behavior and reorg fixtures;
5. required keeper success heartbeat plus dead-machine/alert-path drill documentation;
6. dependency and release-input pinning, or a written itemized risk acceptance for any remaining advisory; and
7. cleanup of the lint baseline and unreachable log-range branch.

The remediation evidence should map each open finding to code, tests, commands, and resulting output. Do not present a passing unit test for one half of a finding as closure of the whole finding.

## 9. Fresh UAT and mainnet launch gates

Because algorithm v2 and claim-domain v2 are intentionally incompatible with the old UAT stack, deploy a fresh UAT stack and prove:

- live Entropy request and callback;
- seed-receipt fallback timing;
- participant deposit, partial transfer to a fresh address, and withdrawal;
- independent keeper/watcher root equality;
- bad-root alert and guardian veto;
- finalization, standard claim, deferred claim, fee claim, reward claim, and auto-compound;
- indexer reorg replacement and vault isolation;
- keeper success heartbeat expiry on process/machine death; and
- fail-closed frontend behavior plus canary transactions.

Before mainnet deposits, additionally prove the active chain-143 manifest, exact bytecode/wiring, four final ownership acceptances, distinct roles, final-owner DrawManager activation, watcher schedule/healthcheck, and Ledger/multisig veto drill.

## 10. Final opinion

The remediation successfully removes the original High-severity code defects. That is meaningful progress. It does not yet close the full-project audit because the indexer, monitoring, supply-chain, and reward-boundary issues remain part of the same production system.

**Final recommendation: GO to fresh UAT; MAINNET NO-GO.** Complete the six open Medium findings, execute the UAT and operational evidence gates, then submit one immutable release candidate for a focused final retest.
