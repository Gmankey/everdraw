# EverDraw V5 full protocol and integration audit brief

**Prepared:** 2026-08-24  
**Repository:** https://github.com/Gmankey/everdraw  
**Immutable audit target:** [`089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b`](https://github.com/Gmankey/everdraw/tree/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b)  
**Target network:** Monad mainnet, chain ID `143`  
**Status:** Pre-deployment. Mainnet dependency preflight passed; no V5 mainnet transaction had been sent when this brief was prepared.

## Engagement request

Please perform a full, independent security audit of the EverDraw V5 protocol intended for the capped mainnet beta. This is not a Solidity-only engagement. It must cover the contracts, deterministic winner/root pipeline, Merkl compatibility, external dependencies, deployment and privileged-role wiring, keeper/watcher/indexer operations, frontend transaction construction and third-party failure handling. This is the first external protocol audit. Prior reviews were internal and must not be treated as independent assurance.

Audit the immutable commit above, not a moving branch. Report Critical, High, Medium, Low and Informational findings, with a proof of concept or failing test where practical. The engagement should include manual review, adversarial testing, invariant/fuzz testing, integration testing, deployment-configuration review and an operational threat-model review. If one firm cannot cover every workstream, quote the workstreams separately and identify the required specialist review; do not silently omit them. Please disclose every scope limitation explicitly.

The principal security objective is:

> A user can always recover no more and no less than the share-denominated value allowed by the documented principal/shortfall model; prize yield cannot be stolen from participants, sponsors or Patron deposits; and no invalid winner root can consume escrow without passing the eight-hour challenge/veto process.

## Solidity scope

The critical Solidity scope is approximately 2,541 lines:

| Component | Role | Source |
|---|---|---|
| `PrizeVaultV5` | Participant, sponsor and Patron principal; deposits, withdrawals, yield escrow, transfer accounting, shortfall and strategy migration | [`src/v5/PrizeVaultV5.sol`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/src/v5/PrizeVaultV5.sol) |
| `DrawManagerV5` | Weekly draw state machine, TWAB snapshot, entropy request, root challenge/veto/finalization, fees and funded rewards | [`src/v5/DrawManagerV5.sol`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/src/v5/DrawManagerV5.sol) |
| `ClaimManagerV5` | Escrow accounting, Merkle distributions, claims, deferred claims and prize auto-compounding | [`src/v5/ClaimManagerV5.sol`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/src/v5/ClaimManagerV5.sol) |
| `EverdrawTwabController` | Participant and delegated balance observations; account and total-principal TWAB calculations | [`src/v5/twab/EverdrawTwabController.sol`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/src/v5/twab/EverdrawTwabController.sol) |
| `ShmonStrategy` | MON deposits into shMON, shMON-share withdrawals, asset/share accounting and strategy migration | [`src/v5/strategies/ShmonStrategy.sol`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/src/v5/strategies/ShmonStrategy.sol) |
| `PythRandomnessOracle` | Pyth Entropy adapter with immutable DrawManager consumer | [`src/PythRandomnessOracle.sol`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/src/PythRandomnessOracle.sol) |
| Interfaces | Strategy and randomness boundaries | [`src/v5/interfaces/IYieldStrategyV5.sol`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/src/v5/interfaces/IYieldStrategyV5.sol), [`src/interfaces/IRandomnessOracle.sol`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/src/interfaces/IRandomnessOracle.sol), [`src/interfaces/IRandomnessOracleConsumer.sol`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/src/interfaces/IRandomnessOracleConsumer.sol) |

Also review all imported local code and vendored Pyth Entropy interfaces/base classes reached by these contracts.

## Critical off-chain boundary

Winner selection is deterministic but computed off-chain and committed as a Merkle root. The following code is therefore in the security boundary even if priced separately from the Solidity review:

- [`scripts/draw/compute-winners.js`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/scripts/draw/compute-winners.js)
- [`scripts/draw/compute_winners.py`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/scripts/draw/compute_winners.py)
- [`scripts/draw/write-watch-inputs.mjs`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/scripts/draw/write-watch-inputs.mjs)
- [`scripts/keeper-v5.js`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/scripts/keeper-v5.js)
- [`scripts/draw/watch-root-proposals.mjs`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/scripts/draw/watch-root-proposals.mjs)

At minimum, confirm Solidity and off-chain agreement on draw intervals, finalized TWAB queries, odds exclusions, seed use, winner count, leaf ordering/domain, token, amount, fees, funded reward legs, Merkle construction and total payout.

## Merkl and shMonad points compatibility

Merkl readiness is explicitly in scope even though campaign activation is deferred until after the beta has users. The audit must determine whether the deployed V5 surface can be registered safely later without another contract migration.

Relevant records and surfaces:

- [ADR-0006: Merkl-readable position surface](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0006-merkl-readable-position-surface.md)
- [ADR-0039: transferable V5 participant position](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0039-v5-transferable-share-token.md)
- [ADR-0040: distinct Patron Pool campaign surface](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0040-v5-prize-booster-vault.md)
- Participant surface: Deposit, Withdraw, Transfer, balanceOf and totalSupply.
- Patron surface: BoostDeposit and BoostWithdraw, including post-action balance and timestamp.
- Sponsor events must remain excluded from every points campaign.

Merkl's current documentation describes standard token-holding campaigns for transferable ERC-20 receipt tokens: https://docs.merkl.xyz/merkl-mechanisms/campaign-types/erc20-mechanisms. The participant vault should be tested as that standard campaign type, with Transfer history and time-weighted balances matching the vault's ERC-20 surface.

The Patron Pool does not issue a transferable receipt token. Merkl's current staking documentation says nonstandard staking/locking contracts require a custom integration and direct coordination: https://docs.merkl.xyz/merkl-mechanisms/campaign-types/staking. Therefore BoostDeposit and BoostWithdraw must not be assumed sufficient merely because the ADR calls them Merkl-readable. Require a Merkl test integration or written technical confirmation for the Patron campaign.

Do not assume the historical ADR-0006 event contract is still sufficient. V5 participant positions became transferable in ADR-0039, while older documentation says Merkl reconstructs positions from only Deposit and Withdraw. Confirm Merkl's current production integrator requirements directly against the final ABI and flag any incompatibility between event-only accounting and transfers.

Required Merkl verification:

1. Reconstruct each participant's position and aggregate supply from the exact event stream across native MON deposits, direct shMON deposits, third-party/auto-compound deposits, partial/full withdrawals and transfers.
2. At every checkpoint, compare the reconstruction to balanceOf(account) and totalSupply(). No transfer may create stale credit for the sender or missing credit for the recipient.
3. Confirm denomination and amount semantics: events and views use MON-equivalent principal while the strategy and payouts use shMON shares. Rounding must not create growing indexer drift.
4. Verify that an auto-compounded prize becomes participant principal and is credited once, not omitted or double-counted.
5. Verify Patron deposits have zero draw odds, never enter the participant campaign and can be reconstructed independently from BoostDeposit and BoostWithdraw.
6. Verify sponsor deposits receive neither participant nor Patron campaign credit.
7. Confirm reorg, duplicate-log, vault-replacement and start-block behavior expected by Merkl. A mainnet V5 address submission must not import V4 or retired-vault balances.
8. Obtain written compatibility confirmation or a test-indexing result from Merkl/shMonad before advertising external points. No campaign multiplier is assumed by this audit; campaign economics remain an operator and partner decision.

## Full-system operational scope

The following components can cause incorrect roots, unsafe transactions, unavailable withdrawals, false UI state or silent operational failure and are therefore in scope:

- Managed V5 keeper, supervisor, persistent cache, terminal-claim quarantine and balance-floor logic under scripts/keeper and scripts/keeper-v5.js.
- Independent root watcher, checkpoint/cache handling and GitHub Actions workflow under scripts/draw and .github/workflows/v5-watcher.yml.
- V5 indexer ingestion, reorg/finality handling, tranche/history/points/checkpoint derivation and active-vault filtering under scripts/indexer.
- Production frontend contract ABIs, address/config selection, transaction method/amount construction, RPC retry/error redaction and network gating under web/src.
- Mainnet Fly, GitHub Actions and Vercel configuration, secret boundaries, health/dead-man alerts, deployment provenance and rollback/runbooks.

This review is not asking an auditor to judge visual styling. It is asking them to verify that every user-visible balance, draw, claim, Patron position and transaction is sourced from the correct chain, contract, vault and unit, and that infrastructure failure cannot silently turn an unsafe state into a normal-looking one.

## Deployment and configuration scope

Review the mainnet deployment path and verify it cannot silently deploy different parameters or incorrect wiring:

- [`scripts/deploy-v5-mainnet.js`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/scripts/deploy-v5-mainnet.js)
- [`hardhat.v5-mainnet.config.js`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/hardhat.v5-mainnet.config.js)
- [`foundry.toml`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/foundry.toml)
- [`tasks/v5-mainnet-deploy-execution-runbook.md`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/tasks/v5-mainnet-deploy-execution-runbook.md)

Locked beta parameters:

| Parameter | Value |
|---|---:|
| Deposit cap | `25,000 MON` |
| Contract minimum deposit | `0` |
| TWAB period | `604,800 seconds` (weekly) |
| Draw period | `604,800 seconds` (weekly) |
| Root challenge window | `28,800 seconds` (8 hours) |
| Proposer grace | `300 seconds` |
| Minimum prize threshold | `0.001 shMON` shares |
| Solidity/EVM artifact target | Solidity `0.8.33`, optimizer 200, via-IR, `paris` |
| Real-shMON fork-test target | `cancun` test profile only; it must not alter deploy artifacts |

`firstPeriodStart` and the TWAB offset are derived at deployment from the launch block and snapped to the TWAB grid. The deployment predicts the DrawManager address and deploys the Pyth adapter with that address as its immutable consumer. It then verifies all runtime bytecode and wiring before printing addresses.

## External contracts and assumptions

### shMON / shMonad

- Mainnet shMON: [`0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`](https://monadscan.com/address/0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c)
- shMON is treated as an appreciating, non-rebasing ERC-4626 share token with 18 decimals.
- EverDraw deposits native MON into shMON, but every V5 payout and withdrawal is made in shMON shares.
- V5 must never synchronously redeem shMON to MON. shMonad redemption is delayed approximately 18-22 hours and occurs outside EverDraw.
- ERC-4626 rounding can credit a native deposit slightly below `msg.value`. An observed real-shMON fork delta was about 0.91 bps in shMON's favour; EverDraw retained no MON or extra shares.
- shMON insolvency, slashing, transfer pause, upgrade or changed ERC-4626 semantics are external risks. The vault has a shortfall mode; it does not insure shMonad losses.

### Pyth Entropy

- Entropy contract: [`0xD458261E832415CFd3BAE5E416FdF3230ce6F134`](https://monadscan.com/address/0xD458261E832415CFd3BAE5E416FdF3230ce6F134)
- Provider: [`0x52DeaA1c84233F7bb8C8A45baeDE41091c616506`](https://monadscan.com/address/0x52DeaA1c84233F7bb8C8A45baeDE41091c616506)
- Preflight fee observed: `0.77 MON` per request. Provider fee and availability are mutable external dependencies.
- Review callback authentication, request-ID mapping, seed re-request behavior, stale callbacks, oracle replacement and immutable consumer wiring.

### Third-party and infrastructure risk register

For each dependency below, assess compromise, outage, stale data, rate limiting, malicious configuration, key leakage and recovery. State whether the result is fund loss, incorrect payout, blocked withdrawal, draw liveness loss, monitoring blindness or display-only degradation.

| Dependency | Security-relevant use |
|---|---|
| shMonad/shMON | Holds all strategy backing; defines share pricing, transfers and delayed MON redemption |
| Pyth Entropy/provider | Supplies draw randomness and charges a mutable fee |
| Monad chain/RPC providers | Transaction submission, logs, historical TWAB reconstruction, indexer and watcher reads |
| Merkl/shMonad points indexer | External participant/Patron rewards derived from public event surfaces |
| Fly.io | Runs keeper and indexer; persistent volumes and secrets affect continuity and correctness |
| GitHub Actions | Runs the independent root watcher; cache/checkpoint persistence affects coverage |
| Healthchecks.io and Telegram | Dead-man and incident notification paths; alert noise or silence can defeat response |
| Vercel | Serves the production frontend and build-time contract/API configuration |
| Wallet connectors/providers | Select chain/account and submit deposits, withdrawals and claims |
| Blockaid/MetaMask scanners | Can warn or block users if the position token/integration is classified incorrectly |
| MonadScan/Sourcify | Verification and allowlisting evidence; not trusted for protocol accounting |

Review secret storage and least privilege across deployer/owner Ledger, guardian, pauser, keeper hot key, Fly secrets, GitHub Actions secrets and Vercel variables. No auditor requires or should receive any private key.

Required failure drills should include RPC outage/rate limiting, keeper crash and restart, watcher cache loss, watcher blindness during a proposal, indexer lag/reorg, stale frontend addresses, Pyth callback delay, shMON transfer/redeem failure and notification delivery failure.

## Architecture and trust model

1. Participant deposits receive a transferable principal position. Participant TWAB determines draw weight.
2. Sponsor and Patron balances contribute principal/yield but delegate their TWAB to odds-exclusion sinks. They must have zero winner odds.
3. At `startDraw`, the completed period is fixed, finalized TWAB is read, and a fixed number of shMON shares is escrowed into `ClaimManagerV5` before a root exists.
4. Pyth returns a seed. The primary proposer computes and proposes a deterministic Merkle root.
5. The root remains challengeable for eight hours. An independent watcher recomputes it; the guardian can veto a mismatch.
6. Anyone can finalize a non-vetoed root after the challenge window. Finalization registers an escrow-backed distribution.
7. Claims pay shMON shares or attempt to auto-compound them into a fresh participant position. A failed compound must fall back to direct payment or a recoverable deferred claim without bricking unrelated claims.

The launch governance model is not trustless:

- Owner, guardian and pauser are operator-controlled roles. The primary proposer is a separately funded hot wallet.
- A malicious proposer can submit a bad root. Safety relies on the eight-hour window, independent watcher and guardian veto. If both monitoring and guardian response fail, an invalid root can finalize.
- Strategy, DrawManager, oracle and draw-period changes have queue/commit delays where specified, but several operational settings remain immediate owner powers. Audit the complete owner/guardian/pauser surface and identify any power that can move, strand, dilute or misclassify funds without adequate delay.
- Keeper, RPC, watcher and Pyth failures affect liveness. Principal withdrawal must remain available unless an external shMON failure prevents share transfer.

## Required security properties

Please attempt to break each property below.

### Principal, shares and solvency

1. `totalPrincipal == participant + sponsor + booster` under every deposit, transfer, withdrawal, auto-compound and migration sequence.
2. Participant token supply and balances remain consistent with participant principal and TWAB balances.
3. Solvent ordinary exits pay the correct par-equivalent shMON shares, subject only to documented ERC-4626 rounding.
4. In shortfall mode, every class receives the documented pro-rata amount; no early caller can extract another class's allocation.
5. Emergency share redemption cannot extract prize yield and cannot be repeated to skim value.
6. Direct/forced native MON sent to the strategy or vault cannot inflate backing, available yield or payouts.
7. `withdrawShares` either transfers the complete calculated amount or reverts atomically; principal must never be erased after a partial transfer.
8. A strategy migration preserves backing within the explicit tolerance, cannot change the share token and cannot exploit callbacks/reentrancy or dishonest strategy return values.
9. Deposits or donations near the cap/minimum, rounding boundaries and zero values cannot bypass limits or create unbacked principal.

### TWAB and winner eligibility

10. TWAB observations remain correct across deposits, partial/full withdrawals, transfers, many writes in one period, ring-buffer wraparound and timestamp/amount integer bounds.
11. A mid-period deposit receives only its time-weighted share; a withdrawal preserves weight already earned but removes future weight.
12. Sponsor and Patron balances are excluded from participant odds at all times while still contributing to total principal/yield accounting.
13. Draw and TWAB periods have no gap, overlap, phantom TWAB or cadence drift, including skipped periods, long keeper outages and a queued/committed draw-period transition during an open period.
14. Only finalized historical TWAB can be used for a draw; no current-period overwrite can alter a completed draw.

### Draw, entropy and root lifecycle

15. Each due period is consumed exactly once, including zero-TWAB, zero-prize and dust skips.
16. Entropy callbacks are authenticated and uniquely mapped; unknown, duplicated, stale or re-requested callbacks cannot seed the wrong draw.
17. Proposal authorization/grace, payout equality, winner count, challenge timing, veto cooldown and finalization transitions cannot be bypassed through boundary timestamps or reentrancy.
18. Escrow occurs before proposal and each finalized distribution is backed by a fixed token/share budget that cannot drift with shMON appreciation.
19. Fee and funded-reward leaves cannot exceed escrow, be double-counted, use an unapproved token or leave an accounting path that steals participant principal.
20. Oracle and cadence changes preserve active-draw determinism and cannot create schedule discontinuities or point the adapter at the wrong consumer.

### Claims and auto-compounding

21. Distribution IDs and leaf hashes are domain-separated; proofs cannot be replayed across sources, distributions, chains, leaf indices, accounts or tokens.
22. Claim bitmaps and per-token budgets prevent duplicate claims and cumulative overpayment, including `claimMany` and reentrant/malicious token behavior.
23. Reserved escrow cannot be released by the owner; only genuinely unreserved assets can be recovered.
24. Auto-compounding credits the strategy-reported asset delta as a fresh position and cannot miscredit the raw prize/share amount.
25. Failed approvals, transfers or compounding cannot brick the entire claim batch, leave dangerous allowances, corrupt reservations or make deferred funds irrecoverable.
26. Claims remain correct when one account wins multiple leaves/draws and when multiple compounds for one account occur in one transaction.

### Administration and deployment

27. Two-step ownership and every queue/commit/cancel flow cannot be bypassed, overwritten unexpectedly or committed with stale/malicious parameters.
28. Pause, stop, cap, minimum, fee, proposer, guardian, pauser, seed-timeout and token-allowlist powers have the intended scope and cannot create an unnoticed fund-loss path.
29. Predicted-address deployment guarantees `PythRandomnessOracle.consumer == DrawManagerV5`; all vault/strategy/TWAB/ClaimManager/DrawManager links and payout tokens are mutually consistent.
30. Runtime bytecode verification and immutable normalization cannot accept an unintended artifact, compiler target or constructor configuration.

### Integration, frontend and operations

31. Merkl can reconstruct participant and Patron balances exactly across every balance-changing path; sponsors receive no external-points credit and transfers cannot duplicate points.
32. Keeper and independent watcher derive identical roots from independently persisted state, and neither silently trusts the other's cached output.
33. A watcher outage or incomplete bootstrap cannot report healthy coverage for a proposal it did not fully recompute.
34. Indexer replays are idempotent and reorg-safe; active-vault filtering prevents retired-vault positions, wins or claims appearing on the live site.
35. Frontend config cannot silently fall back from mainnet to testnet, UAT or a retired stack, and chain mismatch blocks transaction submission.
36. Frontend amount conversions cannot confuse MON-equivalent principal with shMON shares, especially MAX withdrawal, prizes and the external shMonad conversion redirect.
37. RPC retries cannot duplicate a transaction, hide a confirmed failure or display raw provider errors as protocol truth.
38. Keeper balance thresholds track live entropy costs with enough runway; failures alert once with useful severity and the dead-man path cannot be suppressed by noisy non-terminal errors.
39. Secrets are not present in source, logs, build artifacts, browser bundles, standing shell environments or auditor materials; role rotation and revocation are documented and testable.
40. A deploy/cutover cannot expose deposits before keeper, watcher, indexer, alerts and frontend all point to the same verified stack.
41. Recovery procedures preserve withdrawals and evidence during shMON, Pyth, RPC, Fly, GitHub Actions, indexer or frontend outages.
42. Package, container and build dependencies are pinned sufficiently to prevent an unreviewed artifact or supply-chain substitution from reaching production.
43. EverDraw points and entries remain idempotent and internally consistent across tranche tenure, partial-withdraw LIFO, full-withdraw reset, transfers, skipped draws, streaks, bonuses, checkpoints, reorgs and backfills.

## Existing tests

The primary Solidity tests are under [`test/v5/`](https://github.com/Gmankey/everdraw/tree/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/test/v5), including:

- unit and integration tests for all V5 contracts;
- TWAB differential and invariant tests;
- PrizeVault invariants, venue invariants and share-backing hardening;
- ClaimManager acceptance, compound and reentrancy tests;
- delayed-redeem guardrail proving no synchronous shMON redemption is required;
- real mainnet shMON fork lifecycle tests;
- cadence-drift and period-change transition tests.

Reproduction commands:

```bash
npm ci
npm run build
npm run check:abi
forge test
node --test scripts/deploy-v5-mainnet.unit.test.mjs

# Requires an archive-capable Monad mainnet RPC.
MONAD_MAINNET_RPC_URL="<RPC>" \
  forge test --profile fork --match-path 'test/v5/PrizeVaultV5Fork.t.sol'
```

Local verification on 2026-08-24 at the immutable audit target produced:

- forge test: 310 passed, 0 failed, 1 skipped (the RPC-dependent fork setup).
- Mainnet deployment unit tests: 4 passed, 0 failed.
- The invariant suites used the repository configuration of 5,000 runs and depth 50.

The default/deployment EVM target is Paris. The fork profile is Cancun only because deployed mainnet shMON uses opcodes unavailable under Paris. This separation is intentional and must remain intact.

## Prior internal findings and remediations

These documents are evidence and regression context, not an external audit substitute:

- [`tasks/v5-internal-security-review-2026-07-14.md`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/tasks/v5-internal-security-review-2026-07-14.md): found emergency redemption could leak prize yield. Remediated by capping share redemptions at par/pro-rata shortfall value.
- [`tasks/v5-adr0045-focused-security-review-2026-07-29.md`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/tasks/v5-adr0045-focused-security-review-2026-07-29.md): found native MON was incorrectly counted as share-payable backing and strategy withdrawal silently clamped. Also found strategy share-token desynchronization. Both were remediated in PR #244.
- [`tasks/v5-root-watcher-veto-evidence-2026-08-08.md`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/tasks/v5-root-watcher-veto-evidence-2026-08-08.md): observed bad-root detection, alert, guardian veto, corrected root, finalization, claim and auto-compound on UAT.
- [`tasks/v5-fork-suite-and-keeper-floor-evidence-2026-07-29.md`](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/tasks/v5-fork-suite-and-keeper-floor-evidence-2026-07-29.md): real-shMON fork/EVM findings and rounding evidence.

Relevant remediation commits/PRs include:

- [#207](https://github.com/Gmankey/everdraw/pull/207): timelocked DrawManager changes.
- [#216](https://github.com/Gmankey/everdraw/pull/216): real-shMON auto-compound accounting fix.
- [#219](https://github.com/Gmankey/everdraw/pull/219): emergency-redemption prize-yield fix.
- [#231](https://github.com/Gmankey/everdraw/pull/231): ADR-0045 shMON-share-denominated settlement.
- [#244](https://github.com/Gmankey/everdraw/pull/244): native-MON/share-backing and strategy-token invariants.
- [#263](https://github.com/Gmankey/everdraw/pull/263): timelocked cadence changes and transition tests.
- [#271](https://github.com/Gmankey/everdraw/pull/271): locked the mainnet challenge window to eight hours.

Please specifically test for variants and incomplete fixes around every prior finding.

## Design records

The binding architecture records are:

- [ADR-0023: shMON dependency model](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0023-shmon-dependency-model.md)
- [ADR-0029: randomness oracle abstraction](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0029-randomness-oracle-abstraction.md)
- [ADR-0036: V5 TWAB architecture](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0036-v5-twab-architecture.md)
- [ADR-0037: cadence-drift defect and fixed-period requirement](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0037-v4-cadence-drift-defect.md)
- [ADR-0040: Patron Pool](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0040-v5-prize-booster-vault.md)
- [ADR-0041: single-vault consolidation](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0041-single-vault-consolidation.md)
- [ADR-0042: large-deposit security hardening](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0042-degen-pool-security-hardening.md)
- [ADR-0043: prize auto-compound](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0043-v5-prize-auto-compound.md)
- [ADR-0045: shMON-share-denominated payouts](https://github.com/Gmankey/everdraw/blob/089641adfd6b9daed4f0e8195f55d1ee4ecb7e1b/decisions/0045-v5-shmon-share-denominated-payouts.md)

Where implementation and an ADR differ, flag the discrepancy rather than assuming either is safe.

## Known residual risks and explicit questions

Please give a direct opinion on each item:

1. Is the eight-hour optimistic-root challenge model adequate at the 25,000 MON beta cap, given guardian/watcher dependence?
2. Can any owner, guardian, pauser, proposer, strategy or external dependency drain or strand principal faster than users can react?
3. Is the 10 bps solvency/migration tolerance exploitable through repetition, rounding, donation or migration sequencing?
4. Can transferability of participant principal manipulate TWAB, tranche accounting or winner eligibility around period boundaries?
5. Can a malicious or non-standard shMON implementation, ERC-20 return value, callback or approval behavior violate claim/strategy assumptions?
6. Can ring-buffer cardinality, `uint32` timestamps, `uint96` balances or long inactivity produce overflow, stale observations or unavailable TWAB?
7. Can reward schedules, fee recipients or multi-token distributions cause unbounded gas, griefing, token-budget mismatch or stuck escrow?
8. Does `receive()` on the vault, strategy, DrawManager or ClaimManager introduce stranded assets or accounting confusion?
9. Are pause, permanent stop, shortfall recovery and strategy migration sufficient under shMON pause, loss, deprecation or exploit scenarios?
10. Are any NatSpec comments, events or interfaces stale in a way that could cause integrator/operator misuse?

## Out of scope unless separately agreed

- Legacy V1-V4 contracts, which are stopped/retired.
- Pure visual design and copy preferences that cannot change transaction meaning or safety.
- The future transferable Patron receipt and Curvance phase, which is not part of V5 beta bytecode.
- Security of shMonad or Pyth themselves; their integration assumptions and failure handling remain in scope.
- Legal/regulatory review and promises about future cash/token value of points.

## Expected deliverables

1. Draft report with severity, impact, exploit scenario, affected lines and remediation guidance.
2. Reproducible PoC/failing test for each substantive issue where feasible.
3. Review of fixes against the same immutable audit base plus clearly identified remediation commits.
4. Final report stating the exact audited commit, unresolved findings, accepted risks and any unreviewed files.
5. A short mainnet deployment checklist identifying the on-chain wiring and role assertions that must be verified after deployment and again after the 24-hour DrawManager activation.
6. Merkl compatibility matrix covering participant, transfer, auto-compound, sponsor and Patron flows, plus any required Merkl/shMonad confirmation before campaign activation.
7. Third-party risk register with failure impact, detection, fallback, owner and tested recovery procedure.
8. Operational-security report covering key/secret boundaries, keeper/watcher independence, RPC/indexer failure handling, alert delivery and deployment rollback.
9. Frontend transaction-safety report confirming chain, address, unit and method correctness for every deposit, withdrawal and prize flow.
10. EverDraw points-ledger reconciliation showing that visible history, checkpoints and bonuses sum to the API total and cannot be duplicated or retained after a reset.

Please use private disclosure to the operator for all findings until remediation and coordinated publication are complete.
