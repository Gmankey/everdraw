# V5 OPS-20260927-01 strategy migration and release cutover

**Status:** Procedure only. Every mainnet transaction and production deployment requires explicit operator approval.  
**Incident:** OPS-20260927-01  
**Contract review:** PR #319 and its focused independent re-audit  
**Canonical frontend:** `web/`, Vercel project `everdraw`, production branch `staging`

This procedure replaces only `ShmonStrategy`. It preserves the vault, DrawManager,
ClaimManager, TWAB controller, oracle, start block, indexer history, tranche ledger, and points.
Never reset the indexer or user points for this migration.

## 1. Preconditions

- PR #319's final commit has independent approval and is merged to `staging`.
- Working tree is clean and checked out at that exact `origin/staging` commit.
- The current vault strategy still matches the canonical active mainnet record.
- The vault has no pending strategy change.
- The replacement deployer has only enough MON for deployment and initialization.
- The final owner Ledger is available for queue, cancel, and commit.
- Production frontend and keeper operators are available for the coordinated cutover.

Record before/after snapshots for:

- `vault.strategy()`, `pendingStrategy()`, and `pendingStrategyEffectiveAt()`
- old strategy `sharesHeld()`, `totalAssets()`, native balance, `vault()`, and `shareToken()`
- vault `totalPrincipal()`, `availableYield()`, participant/sponsor/Patron totals, and TWAB supply
- the incident wallet's principal and shMON balance

## 2. Deploy and initialize the replacement

The script is preflight-only unless the exact confirmation string is supplied. Every run first compiles
`ShmonStrategy` and validates the required ABI, checked-out source against the Hardhat build input,
artifact against build output, and the production Solidity 0.8.33/Paris/viaIR/optimizer settings. It
reads the signer through the existing Hardhat network configuration and never generates or prints a key.

```bash
git fetch origin staging
git checkout --detach origin/staging
git diff --exit-code
export MONAD_MAINNET_CHAIN_ID=143
export SHMON_ADDRESS=0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c
export PRIZE_VAULT_ADDRESS=0x97D9CA6DDD80869A32C951cc75b75D20e1300eDa
export CURRENT_STRATEGY_ADDRESS=0xA3e037641825B17586cC9B5D4d9473A76f25c44b

HARDHAT_NETWORK=monadMainnet node scripts/deploy-v5-strategy-replacement.js

export CONFIRM_STRATEGY_REPLACEMENT="DEPLOY V5 STRATEGY REPLACEMENT"
HARDHAT_NETWORK=monadMainnet node scripts/deploy-v5-strategy-replacement.js
unset CONFIRM_STRATEGY_REPLACEMENT PRIVATE_KEY
```

The second run must report and verify:

- replacement `shareToken() == SHMON_ADDRESS`
- replacement `vault() == PRIZE_VAULT_ADDRESS`
- replacement `nativeMigrationSource() == CURRENT_STRATEGY_ADDRESS`
- deployment, `setVault`, and `setNativeMigrationSource` receipts

Do not queue if any check differs.

## 3. Prepare the append-only deployment record

Open a PR against `staging`. Append a new V5 record to
`deployments/monad-mainnet.json`; do not overwrite the original active record. Before activation,
use status `strategy-change-queued`. Copy all unchanged component provenance from the current
active record and change only:

- preserve `deployCommit` from the original active stack; record the reviewed replacement commit only in `strategyMigration.sourceCommit` and the replacement component's `sourceCommit`
- `addresses.shmonStrategy`: replacement address
- the `ShmonStrategy` component: constructor args, address, deploy tx/block, compiler settings,
  raw live runtime hash, immutable-normalized build/runtime hash, source/build-info hashes, compiler settings, and verification evidence
- `strategyMigration`: predecessor, replacement, deploy/setVault/setSource/queue receipts,
  source commit, and queue effective time
- `status`: `strategy-change-queued`

Keep `startBlock`, every non-strategy address, ownership, constructor parameters, and historical
indexing metadata unchanged. Run:

```bash
npm run check:deploy-source -- deployments/monad-mainnet.json
MONAD_MAINNET_RPC_URL="<approved mainnet RPC>" npm run check:v5-strategy-replacement -- \
  --deployment-file deployments/monad-mainnet.json \
  --strategy-address <replacement>
```

The generic `check:bytecode` command does not verify nested V5 components and is not an approval
gate for this migration. The dedicated replacement verifier must report `status: verified`; it fails
closed on missing RPC/code, raw or normalized runtime mismatch, stale build/source provenance, changed
historical component provenance, wrong chain, or wrong wiring.

The active deployment parser must continue selecting the old active record before the on-chain
commit. The queued record is provenance, not permission to activate it early.

## 4. Build the candidate frontend before queueing

Make a temporary copy of the reviewed deployment file. In that temporary copy only, append a clone
of the queued migration record with status `draw-manager-committed`. Generate the candidate
manifest with the existing generator:

```bash
node scripts/v5-frontend-release-manifest.mjs   --environment mainnet   --deployment-file /tmp/monad-mainnet-strategy-candidate.json   --rpc-url "<approved browser RPC>"   --explorer-url "https://monadvision.com"   --indexer-url "https://everdraw-indexer.fly.dev"   --claim-proof-url "https://everdraw-indexer.fly.dev/api/v5/claims"   > /tmp/v5-strategy-candidate-manifest.json

cd web
npm run test:v5-release
VITE_V5_ENABLED=true VITE_V5_UAT=false VITE_V5_RELEASE_MANIFEST="$(cat /tmp/v5-strategy-candidate-manifest.json)" npm run build
cd ..
```

The migration regression must prove:

- the old manifest rejects a runtime snapshot containing the replacement strategy;
- the candidate manifest accepts that snapshot;
- direct shMON approval targets the replacement strategy.

A preview built from the candidate is expected to fail closed while the old strategy remains active.
Do not promote that preview yet.

## 5. Queue from the final-owner Ledger

From the Ledger owner, call
`PrizeVaultV5.queueStrategyChange(replacementStrategy)`. Record the receipt and effective time in
the queued deployment record. Verify the pending address through two RPCs. During the 24-hour
timelock:

- keep the normal keeper, watcher, indexer, and alerts running;
- monitor normal and emergency withdrawals;
- rerun the dedicated V5 replacement verifier and retain its raw and normalized runtime evidence;
- cancel from the Ledger if bytecode, wiring, accounting, or service readiness differs.

## 6. Coordinated activation

Do not activate the frontend before the strategy commit. At the agreed cutover:

1. Take final old/new strategy, principal, yield, share, native-balance, and TWAB snapshots.
2. Simulate `commitStrategyChange()` and the incident wallet's complete `withdrawShmon`.
3. From the Ledger owner, call `commitStrategyChange()`.
4. Verify atomically:
   - vault strategy is the replacement;
   - old shMON share balance is zero;
   - replacement share balance equals the pre-commit old balance;
   - all forced native MON moved to the replacement;
   - native MON is absent from `totalAssets()` and `availableYield()`;
   - principal, TWAB, sponsor, and Patron accounting are unchanged.
5. Rerun the dedicated V5 replacement verifier against the post-commit wiring, then append a new `draw-manager-committed` record to `deployments/monad-mainnet.json`, preserving
   the queued record and adding the commit receipt/time. Merge that record to `staging`.
6. Generate the final frontend manifest from the canonical file and confirm it is equivalent to
   the tested candidate for all addresses.
7. Set the production `VITE_V5_RELEASE_MANIFEST` on Vercel project `everdraw` and redeploy the
   `staging` production branch.
8. Redeploy the managed mainnet keeper from the same `staging` commit so its deployment manifest
   provenance names the replacement. DrawManager, ClaimManager, and from-block secrets do not change.
9. Do not change indexer addresses or `START_BLOCK`; verify continuous ingestion and reconciliation.

The transition is intentionally fail-closed: old bundles reject writes after the on-chain commit,
and the candidate bundle rejects writes before it. Ask users with an old bundle to reload after the
production artifact is live. Do not weaken `assertV5RuntimeSnapshot`.

## 7. Live verification and closure evidence

After the production artifact is live:

```bash
curl -s https://everdraw.xyz/ | grep -o 'assets/index-[^" ]*\.js' | head -1
flyctl status -a everdraw-keeper-v5-mainnet
curl -s https://everdraw-indexer.fly.dev/api/health
```

Record evidence that:

- the live bundle contains the replacement address and runtime verification passes;
- shMON deposit approval targets the replacement;
- native and direct-shMON deposits simulate successfully;
- partial and MAX `withdrawShmon` simulate successfully;
- keeper and root watcher continue progressing;
- indexer principal/tranche state reconciles without reset;
- the incident wallet completes a normal full exit, with principal and TWAB reaching zero;
- replacement native MON remains excluded from principal and prize yield.

Only then close OPS-20260927-01. The permissionless `emergencyRedeemShares` route remains available
throughout the migration.
