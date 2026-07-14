# Runbook - ADR-0043 V5 prize auto-compound UAT redeploy + re-point

**Implements:** ADR-0043 (`decisions/0043-v5-prize-auto-compound.md`) and the ADR-0042 timelocked draw-manager owner surface (`decisions/0042-degen-pool-security-hardening.md`).

**Scope:** deploy/wiring tooling only - `scripts/redeploy-v5-claim-draw-managers.js` plus config placeholders. **No live deploy has been executed by this PR.** The operator/PM runs the commands below with the real signer and platform access.

## Why this redeploy is needed

`DrawManagerV5.claimManager` is immutable. The pre-ADR-0043 UAT `ClaimManagerV5` predates auto-compound, so ADR-0043 requires a new `ClaimManagerV5`, which forces a new `DrawManagerV5` even though the draw-manager logic is otherwise unchanged.

The vault (`0x76A1327c69f6f9f2571b131BB528D0c8ce1D6958`), TWAB controller, and shMON strategy are not redeployed. They hold live UAT deposits/tranches and must not be disturbed.

## Important ADR-0042 change

`PrizeVaultV5.setDrawManager(address)` is now a compatibility alias for the timelocked draw-manager change flow. A redeploy is therefore **two-phase**:

1. Deploy new `ClaimManagerV5` + `DrawManagerV5`, configure the claim manager, and queue the vault draw-manager change.
2. Wait the vault delay (`STRATEGY_CHANGE_DELAY`, currently 24 hours), then commit the queued draw-manager change.

Do not re-point the keeper, indexer, or frontend until phase 2 verifies `vault.drawManager() == <NEW_DRAW_MANAGER>`. If those services are pointed at the new manager before the vault commit, the system is half-wired.

## Who needs a key or platform access

| Step | Requires signer/key? | Who |
|---|---|---|
| 1. Deploy new claim/draw managers + queue vault change | Yes - current `PrizeVaultV5` owner key, pays gas for 2 deployments + setup txs + queue tx | Operator |
| 2. Commit the queued vault draw-manager change | Yes - current `PrizeVaultV5` owner key, after the delay | Operator |
| 3. Re-point keeper (`fly.v5.uat.toml` + Fly deploy) | No private key in command, but needs Fly deploy access. Keeper private key remains a Fly secret set by operator | Operator/PM |
| 4. Re-point indexer (`flyctl secrets set -a everdraw-indexer-uat ...`) | No private key, but needs Fly access | Operator/PM |
| 5. Re-point frontend (Vercel env + redeploy) | No private key, but needs Vercel access | Operator/PM |
| 6. Verification | No | Anyone |

This runbook never asks the builder to generate, paste, inspect, or hold a private key.

---

## Step 1 - Deploy new ClaimManagerV5 + DrawManagerV5 and queue the vault re-point

Preflight: the selected vault must expose pendingDrawManager() and pendingDrawManagerEffectiveAt(). The script checks this before deploying anything and aborts if the vault bytecode predates PR #207. Do not run this two-phase flow against an older vault without re-deriving the runbook.

```bash
# From repo root. Requires PRIVATE_KEY (the PrizeVaultV5 owner's key) and
# MONAD_TESTNET_RPC_URL set in the environment through hardhat.config.js.
npx hardhat run scripts/redeploy-v5-claim-draw-managers.js --network monadTestnet
```

What the script does:

1. Reads the current live V5 record from `deployments/monad-testnet.json`.
2. Reuses the existing vault, TWAB controller, shMON strategy, and oracle.
3. Deploys a new `ClaimManagerV5`.
4. Deploys a new `DrawManagerV5` wired to the new claim manager and existing vault/TWAB/oracle.
5. Calls `claimManager.setAuthorizedSource(newDrawManager, true)`.
6. Calls `claimManager.setCompoundVault(newDrawManager, existingVault)`.
7. Calls `vault.queueDrawManagerChange(newDrawManager)`.
8. Appends a deployment record with `status: "deployed-draw-manager-queued"`, the new addresses, `drawManagerTimelock.effectiveAt`, and the commit command.

**Verification before waiting:**

```bash
cast call <PRIZE_VAULT_ADDRESS> "pendingDrawManager()(address)" --rpc-url https://testnet-rpc.monad.xyz
cast call <PRIZE_VAULT_ADDRESS> "pendingDrawManagerEffectiveAt()(uint64)" --rpc-url https://testnet-rpc.monad.xyz
cast call <PRIZE_VAULT_ADDRESS> "drawManager()(address)" --rpc-url https://testnet-rpc.monad.xyz
```

Expected:

- `pendingDrawManager()` equals the new `DrawManagerV5`.
- `pendingDrawManagerEffectiveAt()` matches the timestamp recorded by the script.
- `drawManager()` still equals the previous active draw manager until Step 2 commits.

Stop here until the effective timestamp has passed.

---

## Step 2 - Commit the queued draw-manager change after the delay

Run this only after `pendingDrawManagerEffectiveAt` has passed:

```bash
HARDHAT_NETWORK=monadTestnet node scripts/redeploy-v5-claim-draw-managers.js --commit
```

What the commit mode does:

1. Reads the latest V5 deployment record.
2. Verifies the signer is the vault owner.
3. Verifies `pendingDrawManager()` equals the draw manager in the deployment record.
4. Refuses to run if the timelock has not elapsed.
5. Calls `vault.commitDrawManagerChange()`.
6. Verifies `vault.drawManager()` equals the new draw manager.
7. Appends a commit record with `status: "draw-manager-committed"`.

**Verification before re-pointing anything else:**

```bash
cast call <PRIZE_VAULT_ADDRESS> "drawManager()(address)" --rpc-url https://testnet-rpc.monad.xyz
cast call <PRIZE_VAULT_ADDRESS> "pendingDrawManager()(address)" --rpc-url https://testnet-rpc.monad.xyz
cast call <PRIZE_VAULT_ADDRESS> "pendingDrawManagerEffectiveAt()(uint64)" --rpc-url https://testnet-rpc.monad.xyz
```

Expected:

- `drawManager()` equals the new `DrawManagerV5`.
- `pendingDrawManager()` is zero.
- `pendingDrawManagerEffectiveAt()` is zero.

Only after this verification should keeper, indexer, and frontend be re-pointed.

---

## Step 3 - Re-point the keeper

Update `scripts/keeper/fly.v5.uat.toml` with the committed addresses:

- `DRAW_MANAGER_ADDRESS` = new committed `DrawManagerV5`
- `CLAIM_MANAGER_ADDRESS` = new `ClaimManagerV5`
- `V5_KEEPER_FROM_BLOCK` remains the vault genesis block unless a future keeper ticket changes that rule. For the current UAT vault this is `41820841`.

Then deploy the managed keeper:

```bash
flyctl deploy . -c scripts/keeper/fly.v5.uat.toml
```

**Verification:**

```bash
flyctl logs -a everdraw-keeper-v5 -f
```

Confirm it boots against the new draw/claim manager addresses and advances draws without `NotDrawManager`, `OnlyConsumer`, or claim-manager source authorization errors.

---

## Step 4 - Re-point the indexer + backfill

`everdraw-indexer-uat` config is Fly-secret-authoritative. `POOL_ADDRESSES` must include the vault, committed draw manager, and new claim manager.

```bash
flyctl secrets set -a everdraw-indexer-uat \
  POOL_ADDRESSES="<VAULT_ADDRESS_UNCHANGED>,<NEW_DRAW_MANAGER>,<NEW_CLAIM_MANAGER>" \
  START_BLOCK="<startBlock from the Step 1 deployment record>"
```

Setting a Fly secret restarts the machine. Confirm backfill before assuming the API is fresh:

```bash
curl -s https://everdraw-indexer-uat.fly.dev/api/health
flyctl logs -a everdraw-indexer-uat -f
```

`POOL_EVENT_ABI` now includes `PrizeCompounded`, so compounded prizes should appear as deposit-equivalent tranches with `source/reason = "prize_compound"` in history.

---

## Step 5 - Re-point the frontend

Vercel project: `everdraw-v5-uat` (`https://everdraw-v5-uat.vercel.app`). Update:

- `VITE_V5_DRAW_MANAGER_ADDRESS` -> new committed draw manager
- `VITE_V5_CLAIM_MANAGER_ADDRESS` -> new claim manager
- Leave `VITE_V5_PRIZE_VAULT_ADDRESS` and `VITE_V5_TWAB_CONTROLLER_ADDRESS` unchanged

Then redeploy. Vite bakes `VITE_*` variables into the bundle, so changing env vars alone is not enough.

**Live bundle verification:** fetch the deployed JS bundle and confirm the new draw/claim manager addresses are present.

---

## Step 6 - End-to-end UAT verification

Only after Steps 1-5 are independently verified:

1. Run a paying draw end-to-end on UAT.
2. Confirm a non-opted-out winner's `principalOf` grew by the prize amount and a fresh tranche opened at tenure 0.
3. Confirm points derive on that tranche at the base multiplier.
4. Confirm the frontend shows the win as automatically restaked.
5. Confirm an opted-out wallet still receives MON to wallet, not a vault credit.
6. Complete the ADR-0042 scoped review of the ClaimManager -> Vault path and run the full UAT soak before any mainnet plan.

## Rollback

Rollback is also timelocked now. To repoint the vault back to a prior draw manager, the owner must:

1. `queueDrawManagerChange(<OLD_DRAW_MANAGER>)`
2. Wait `STRATEGY_CHANGE_DELAY`
3. `commitDrawManagerChange()`

Old `ClaimManagerV5` / `DrawManagerV5` contracts remain deployed and readable. Any distributions already registered against a claim manager remain claimable there independently of the vault's active draw manager.

## External dependencies

- **Monad testnet RPC** - deploy script and verification calls depend on it.
- **Fly** - keeper and indexer deployment/config depend on Fly availability.
- **Vercel** - frontend re-point and redeploy depend on Vercel availability.
- **PrizeVaultV5 owner key** - required for queue and commit; if lost, the vault cannot be re-pointed.
- **Pyth oracle wiring** - the reused oracle must be valid for the committed draw manager, or a separate oracle consumer fix/runbook must be executed before keeper soak.
