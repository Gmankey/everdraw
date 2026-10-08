# EverDraw V5 Patron capital remediation runbook

Date: 2026-10-08

Status: prepared only; no live execution authorized

Decision record: ADR-0051

Source finding: `tasks/v5-patron-capital-review-2026-10-08.md`

## Safety boundary

- Do not raise the 25,000 MON cap.
- Do not deposit the proposed 1,500,000 MON.
- Do not execute this runbook until the remediation PR and pinned-fork evidence receive independent approval.
- The current mainnet vault is repaired only to restore exits. It does not gain the new Patron emergency exit or constrained-migration code and must remain withdraw-only after migration.
- A fresh full-stack deployment is required for the complete ADR-0051 design.
- Every transaction must be simulated, decoded, and independently checked before signing.
- Never put a private key in this document, the repository, shell history, or chat.

## Canonical live targets

Read these from the last protocol-version-5 record in `deployments/monad-mainnet.json` and confirm them independently:

- Vault: `0x97D9CA6DDD80869A32C951cc75b75D20e1300eDa`
- Current strategy: `0xA3e037641825B17586cC9B5D4d9473A76f25c44b`
- shMON: `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`
- Vault owner: `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2`
- Pauser: `0x4fD78E6eb3B66E8624Ee6aE579866947415adedC`

Abort on any mismatch.

## Phase 0 - independent approval and controls

1. Record the approved commit and auditor report.
2. Confirm the root watcher, keeper, indexer, Telegram, and dead-man checks are healthy.
3. Confirm the pauser can cancel both a queued strategy change and a queued DrawManager change on the fresh release.
4. Pause new deposits on the current vault. Confirm ordinary and emergency withdrawals remain callable.
5. Capture two-RPC snapshots of:
   - owner, pauser, active/pending strategy and activation time;
   - participant, sponsor, and Patron principal totals;
   - current strategy shMON balance and `totalAssets()`;
   - shMON proxy implementation and `convertToAssets(1e18)`;
   - current deposit cap and paused/stopped state.

## Phase 1 - read-only migration plan

From the approved staging commit:

```sh
HARDHAT_NETWORK=monadMainnet \
node scripts/migrate-v5-shmon-strategy-mainnet.js
```

This sends no transactions. Save the JSON output under `tasks/` and have a second reviewer confirm the targets and calldata.

## Phase 2 - deploy and bind the corrected adapter

The operator supplies a funded deployment signer through the existing Hardhat network configuration. The script does not read, prompt for, print, or persist a key itself.

```sh
HARDHAT_NETWORK=monadMainnet \
node scripts/migrate-v5-shmon-strategy-mainnet.js --deploy
```

Record the strategy address, deployment receipt, `setVault` receipt, runtime codehash, `shareToken()`, and `vault()`. The expected values are mainnet shMON and the current vault.

Independently verify without signing:

```sh
HARDHAT_NETWORK=monadMainnet \
NEW_STRATEGY_ADDRESS=<replacement> \
node scripts/migrate-v5-shmon-strategy-mainnet.js --verify
```

At this point the replacement must be neither active nor funded. Do not proceed if it has any unexpected shMON balance or vault binding.

## Phase 3 - Ledger queue and 24-hour review

Using the recorded vault owner Ledger, call `queueStrategyChange(<replacement>)` on the current vault. The read-only/deploy output prints the exact calldata for independent decoding.

After the receipt:

1. Confirm `StrategyChangeQueued` contains the reviewed replacement.
2. Confirm `pendingStrategy()` and `pendingStrategyEffectiveAt()` from two RPCs.
3. Confirm monitoring alerts.
4. Re-run `--verify`.
5. Wait the full `STRATEGY_CHANGE_DELAY`.
6. Cancel from the owner if any check differs. The deployed current vault does not grant its pauser cancellation authority; that improvement exists only in the fresh release.

## Phase 4 - Ledger commit and conservation checks

After the timelock and final approval, the owner Ledger calls `commitStrategyChange()`. Before signing, simulate and decode the exact target and selector.

Immediately after mining, verify:

- `vault.strategy() == replacement`;
- old strategy shMON balance is zero;
- replacement shMON balance equals the old pre-commit share balance exactly;
- replacement `totalAssets()` is not below the accepted rounding tolerance;
- all three recorded principal totals are unchanged;
- no unexpected native MON or token transfer occurred.

Run:

```sh
HARDHAT_NETWORK=monadMainnet \
NEW_STRATEGY_ADDRESS=<replacement> \
node scripts/migrate-v5-shmon-strategy-mainnet.js --verify
```

Save receipts and before/after snapshots under `tasks/`.

## Phase 5 - prove the current holder can exit

1. Execute a small partial participant withdrawal to shMON.
2. Re-run the conservation snapshot.
3. Execute the remaining full participant withdrawal.
4. Confirm participant principal is zero, the recipient received the expected shares, and no unrelated ledger backing decreased.
5. Keep this vault paused and withdraw-only. Do not reopen deposits.

## Phase 6 - fresh ADR-0051 stack

Deploy a fresh full V5 stack from the independently approved commit using the existing guarded mainnet deployment flow. Before activation, verify:

- vault `strategyCodehash()` equals the deployed strategy runtime codehash;
- strategy `vault()` and `shareToken()` are exact;
- Patron emergency share exit exists;
- owner and pauser cancellation paths are tested;
- DrawManager, oracle, ClaimManager, TWAB, keeper, watcher, indexer, and frontend manifest point only to the fresh stack;
- the deposit cap remains no more than 25,000 MON;
- final owner is the approved multisig, not a single EOA.

Observe the normal DrawManager activation delay. Re-point services only after on-chain activation and independent wiring verification.

## Phase 7 - live acceptance

Use small amounts and prove, on the final stack:

1. participant native deposit and complete shMON exit;
2. participant direct-shMON deposit and complete exit;
3. sponsor native and direct-shMON deposit/exit;
4. Patron native and direct-shMON deposit/exit;
5. mixed participant/Patron exit ordering without cross-holder backing loss;
6. draw escrow, root watcher match, finalization, automatic prize compounding, and post-claim full exit;
7. emergency participant, sponsor, and Patron share exits while paused;
8. frontend served manifest, approval spender, indexer history, keeper, watcher, and alerts.

Independent review signs off on the saved evidence before deposits reopen.

## Large-allocation gate

The 1,500,000 MON proposal remains NO-GO after technical remediation alone. It additionally requires:

- explicit acceptance of shMON governance, solvency, transfer, and native-liquidity risk;
- independently controlled hardware-backed multisig signers and a tested recovery procedure;
- a separately approved staged cap plan;
- monitoring and keeper funding evidence;
- a small complete deposit-to-exit rehearsal followed by bounded allocation stages.

Any failed stage stops the rollout.
