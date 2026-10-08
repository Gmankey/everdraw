# EverDraw V5 Patron capital remediation evidence

Date: 2026-10-08

Branch: `codex/v5-patron-capital-hardening`

Base reviewed: `origin/staging` at `dee006ce6a37734f1561351b51582b9b1ce0a411`

Source report: `tasks/v5-patron-capital-review-2026-10-08.md`

Decision: ADR-0051

## Disposition

The code remediation closes the source-level causes of PC-01, PC-02, and PC-03 for independent review:

- PC-01: deposits, total backing, share payouts, prize escrow, and migrations use one fee-free `convertToAssets` accounting basis.
- PC-02: fresh vaults restrict replacement strategies to the initial runtime codehash, recheck it at commit, require vault binding, require exact share migration, and allow the independent pauser to cancel queued strategy and DrawManager changes.
- PC-03: fresh vaults expose a Patron/booster emergency share exit with the same principal and shortfall semantics as participant and sponsor exits.

This does not authorize a live transaction, cap increase, or 1,500,000 MON Patron deposit.

## Regression coverage

### Unit and local integration

```sh
forge test --match-path test/v5/PrizeVaultV5.t.sol -q
forge test --match-path test/v5/PrizeVaultV5ShareBackingHardening.t.sol -q
```

Result: PASS.

Coverage includes:

- participant, sponsor, and Patron complete exits despite a fee-bearing underlying redemption quote;
- direct-share deposits credit fee-free backing;
- a Patron exit cannot consume participant backing;
- final-withdrawal dust and rounding direction;
- Patron emergency exit while paused/stopped;
- Patron emergency shortfall payout;
- target vault binding;
- exact runtime-code allowlisting at queue and commit;
- exact share migration;
- owner/pauser cancellation and rejection of unrelated callers.

### Real shMON pinned fork

Pinned block: `111477200`, chain 143.

```sh
MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz \
MONAD_MAINNET_FORK_BLOCK=111477200 \
FOUNDRY_PROFILE=fork \
forge test --match-path test/v5/PrizeVaultV5Fork.t.sol -vv
```

Result: 12 passed, 0 failed, 0 skipped.

The matrix covers native and direct-shMON inputs, participant/sponsor/Patron full exits, sole and mixed holders, post-draw prize escrow and auto-compound, first/last exit ordering, and unrelated-holder backing conservation.

An initial run against `rpc1.monad.xyz` was interrupted by Cloudflare HTTP 429 after 8 passes. The four affected cases were rerun against `rpc.monad.xyz`; three passed immediately and the fourth identified a 1-wei test-quote rounding assumption. The assertion now verifies the exact aggregate backing delta and a maximum 1-wei difference from the standalone share quote. The complete 12-test matrix then passed on the alternate endpoint.

### Current live-vault migration simulation

```sh
MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz \
FOUNDRY_PROFILE=fork \
forge test --match-path test/v5/PatronCapitalMigrationFork.t.sol -vv
```

Result: 1 passed, 0 failed, 0 skipped.

At the report's pinned state, the test deploys and binds the corrected adapter, impersonates the recorded vault owner only inside the fork, observes the 24-hour delay, commits the migration, verifies share movement, and proves the current live participant can fully exit.

### Deployment tooling

```sh
node --test scripts/deploy-v5-mainnet.unit.test.mjs
node --test scripts/migrate-v5-shmon-strategy-mainnet.unit.test.mjs
node --check scripts/deploy-v5-mainnet.js
node --check scripts/deploy-v5-testnet.js
node --check scripts/resume-v5-testnet-deploy.js
node --check scripts/migrate-v5-shmon-strategy-mainnet.js
git diff --check
```

Result: PASS. The mainnet deployment source test now requires the strategy-codehash assertion.

### Full suite

```sh
forge test -q
```

Result: PASS, exit 0.

## Prepared migration controls

`scripts/migrate-v5-shmon-strategy-mainnet.js`:

- reads targets from the canonical mainnet deployment record;
- aborts off chain 143 or on shMON/active-strategy mismatches;
- defaults to a read-only plan;
- deploys and binds only with explicit `--deploy`;
- verifies a supplied replacement with explicit `--verify`;
- prints queue, commit, and cancel calldata for independent Ledger decoding;
- does not prompt for, print, store, or otherwise handle a private key.

The read-only plan was executed successfully at mainnet block `111509287`. It confirmed the
recorded vault, owner, pauser, active strategy, and shMON; no strategy was pending. It reported
`1.006010100738197926 MON` recorded participant principal, `0.616510436451682373 shMON` in the
old adapter, and `1.006440028696332928 MON` of fee-free accounting backing. No transaction was
created or sent.

`npx hardhat compile` also passed: 24 Solidity files compiled for the Paris deployment target.

The governed sequence and abort conditions are in `tasks/v5-patron-capital-remediation-runbook.md`.

## Remaining non-code gates

1. Independent re-audit of this exact commit and evidence.
2. Owner approval of revised risk copy before the frontend text is changed.
3. Current-vault adapter migration and live complete-exit evidence under the runbook.
4. Fresh full-stack deployment and complete live acceptance on final bytecode.
5. Reviewed multisig ownership with independently controlled hardware signers before any material cap increase.
6. Explicit acceptance of residual shMON governance, solvency, transfer, and native-liquidity risk.
7. Separate approval of a staged allocation plan. The 1,500,000 MON proposal remains NO-GO until all gates close.
