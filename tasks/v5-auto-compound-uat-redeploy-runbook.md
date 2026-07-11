# Runbook — ADR-0043 V5 prize auto-compound UAT redeploy + re-point

**Implements:** ADR-0043 (`decisions/0043-v5-prize-auto-compound.md`), per the builder ticket at
`tasks/v5-prize-auto-compound-builder-ticket.md`.

**Scope of this PR:** deploy/wiring tooling only — `scripts/redeploy-v5-claim-draw-managers.js`
plus config placeholders. **No live deploy has been executed.** Everything below is what the
operator/PM (with real key access) still needs to run manually, in order, to complete the
redeploy on UAT. The contract source (PrizeVaultV5.depositFor, ClaimManagerV5 compound path +
opt-out registry) is already merged via PR #196 / #201; only the deployed bytecode is stale.

## Why this redeploy is needed

`DrawManagerV5.claimManager` is `immutable`. The currently-live UAT `ClaimManagerV5`
(`0xF95e319f71B503e396295CD0A55550f56f5901eb`) predates the auto-compound logic, so a new
`ClaimManagerV5` must be deployed — which forces a new `DrawManagerV5`
(`0x9eb6387EeA7daC93AF9585b5D25bfc7e0A3aD89c` is superseded) even though `DrawManagerV5`'s own
logic is unchanged. The vault (`0x76A1327c69f6f9f2571b131BB528D0c8ce1D6958`), TWAB controller, and
shMON strategy are **not** redeployed — they hold live UAT deposits/tranches and must not be
disturbed. They are re-pointed to the new `DrawManagerV5` via the vault's existing
`setDrawManager` call.

**Important correction vs. the original ticket assumption:** `setDrawManager` is **not**
timelocked in the currently deployed `PrizeVaultV5.sol` (verified by reading the source — it's a
single `onlyOwner` call with no queue/commit state). ADR-0042 §18 *recommends* adding a timelock
here, but that hardening has not shipped. The redeploy script below therefore calls
`setDrawManager` directly and takes effect in the same transaction. If a timelocked
`setDrawManager` ships before this runbook is executed, **stop and re-derive this step** — do not
assume the flow below still applies.

## Who needs a private key for which step

| Step | Requires a signer/key? | Who |
|---|---|---|
| 1. Run the redeploy script | **Yes** — must be the current `PrizeVaultV5` owner's key (`setDrawManager` is `onlyOwner`), and pays gas for 2 contract deployments + 3 setup txs | Operator |
| 2. Update `deployments/monad-testnet.json` | No — the script does this automatically | n/a |
| 3. Re-point keeper (`fly.v5.uat.toml` + `flyctl deploy`) | No key, but needs Fly deploy access | Operator/PM |
| 4. Re-point indexer (`flyctl secrets set -a everdraw-indexer-uat ...`) | No key, but needs Fly access | Operator/PM |
| 5. Re-point frontend (Vercel env + redeploy) | No key, but needs Vercel access | Operator/PM |
| 6. Verification (all steps below) | No | Anyone |

Steps 2–6 are pure config/infra and safe for anyone with the relevant platform access to run once
step 1's addresses exist. Step 1 is the only step that touches funds/ownership.

---

## Step 1 — Deploy new ClaimManagerV5 + DrawManagerV5, re-point the vault

```bash
# From repo root. Requires PRIVATE_KEY (the PrizeVaultV5 owner's key) and
# MONAD_TESTNET_RPC_URL set in the environment (same mechanism hardhat.config.js already uses
# for scripts/deploy-v5-testnet.js -- not changed by this script).
npx hardhat run scripts/redeploy-v5-claim-draw-managers.js --network monadTestnet
```

What it does (see the script's header comment for full detail):
1. Reads the current live V5 record from `deployments/monad-testnet.json` (vault, TWAB
   controller, oracle — all reused unchanged).
2. Deploys a new `ClaimManagerV5`.
3. Deploys a new `DrawManagerV5` wired to that new `ClaimManagerV5` (immutable ctor arg) and the
   **existing** vault/TWAB/oracle.
4. `claimManager.setAuthorizedSource(newDrawManager, true)` — lets the new draw manager register
   distributions.
5. `claimManager.setCompoundVault(newDrawManager, existingVault)` — turns on ADR-0043
   auto-compound-by-default for this distribution source, targeting the existing vault.
6. `vault.setDrawManager(newDrawManager)` — takes effect immediately (see the timelock note
   above).
7. Appends a new record to `deployments/monad-testnet.json` with the new addresses under
   `addresses`, and the OLD claim/draw manager addresses preserved under `priorAddresses` (nothing
   is overwritten or lost — old records in the `contracts` array stay intact too).

**Verification (CLAUDE.md rule 6 — do this before moving on):**
```bash
# Confirm the vault actually points at the new draw manager on-chain, not just in the JSON file:
cast call <PRIZE_VAULT_ADDRESS> "drawManager()(address)" --rpc-url https://testnet-rpc.monad.xyz
# Should equal the new DrawManagerV5 address from the script's console output / deployment record.

# Confirm the new ClaimManagerV5 has the new source authorized and compound vault set:
cast call <NEW_CLAIM_MANAGER> "authorizedSource(address)(bool)" <NEW_DRAW_MANAGER> --rpc-url https://testnet-rpc.monad.xyz
cast call <NEW_CLAIM_MANAGER> "compoundVaultFor(address)(address)" <NEW_DRAW_MANAGER> --rpc-url https://testnet-rpc.monad.xyz
```
Record the new `drawManager` and `claimManager` addresses and the record's `startBlock` — you
need them for every step below.

---

## Step 2 — Re-point the keeper

`scripts/keeper/fly.v5.uat.toml` now has `TODO_SET_AFTER_ADR_0043_REDEPLOY` placeholders for
`DRAW_MANAGER_ADDRESS`, `CLAIM_MANAGER_ADDRESS`, and `V5_KEEPER_FROM_BLOCK`. Fill them in with the
Step 1 output, then:

```bash
flyctl deploy . -c scripts/keeper/fly.v5.uat.toml
```

**Verification:**
```bash
flyctl logs -a everdraw-keeper-v5 -f
# Confirm it boots against the NEW draw/claim manager addresses (log line at startup) and, once a
# draw finalizes, that it executes compounds (not just wallet claims) for non-opted-out winners.
```

---

## Step 3 — Re-point the indexer + backfill

`everdraw-indexer-uat` config is Fly-secret-authoritative (no committed per-env toml — see
`scripts/indexer/README.md`, new "ADR-0043" section added in this PR). `POOL_ADDRESSES` must
contain all three V5 contract addresses (vault + draw manager + claim manager); only the draw
manager and claim manager entries change.

```bash
flyctl secrets set -a everdraw-indexer-uat \
  POOL_ADDRESSES="<VAULT_ADDRESS_UNCHANGED>,<NEW_DRAW_MANAGER>,<NEW_CLAIM_MANAGER>" \
  START_BLOCK="<startBlock from the Step 1 deployment record>"
```

Setting a Fly secret restarts the machine, which will start a full backfill from `START_BLOCK`
(the indexer has no incremental "just the new contracts" mode — it re-scans its whole configured
range on `POOL_ADDRESSES` change since the confirmed-head cursor is keyed to the deployment, not
per-address). On UAT's block volume this should be a fast backfill; confirm before assuming it's
instant.

**Verification:**
```bash
curl -s https://everdraw-indexer-uat.fly.dev/api/health
flyctl logs -a everdraw-indexer-uat -f
# Confirm "lastScannedBlock" advances past the new startBlock and event counts are non-zero once
# there's on-chain activity against the new contracts.
```

**Known gap, not fixed by this PR:** `scripts/indexer/src/runner/abi.ts`'s `POOL_EVENT_ABI` does
not yet include ClaimManagerV5's `PrizeCompounded` event, so the indexer will ingest a compounded
prize as a plain `Deposit` (correct for points/tranche math) but cannot yet label it "prize
restaked" in history. Flagged as a follow-up, not blocking this redeploy.

---

## Step 4 — Re-point the frontend

Vercel project `everdraw-v5-uat` (site: `everdraw-v5-uat.vercel.app`). Update:
- `VITE_V5_DRAW_MANAGER_ADDRESS` → new draw manager address
- `VITE_V5_CLAIM_MANAGER_ADDRESS` → new claim manager address
- Leave `VITE_V5_PRIZE_VAULT_ADDRESS` and `VITE_V5_TWAB_CONTROLLER_ADDRESS` unchanged.

Then **redeploy** — Vite bakes `VITE_*` vars in at build time, so changing the env var alone does
not update the live bundle (this is exactly the CDN/env-resolution failure mode CLAUDE.md rule 6
calls out). Either push a commit that touches `web/` or trigger a manual redeploy from the Vercel
dashboard / `vercel --prod`.

**Verification (CLAUDE.md rule 6 — check the LIVE bundle, not just the dashboard):**
```bash
curl -s https://everdraw-v5-uat.vercel.app/ | grep -o 'assets/index-[^"]*\.js' | head -1
# fetch that bundle and confirm the new draw/claim manager addresses appear in it, e.g.:
curl -s https://everdraw-v5-uat.vercel.app/assets/index-<hash>.js | grep -o '<NEW_DRAW_MANAGER>'
```
Or simpler: load the site, open devtools, and inspect whatever the app surfaces the configured
`drawManager`/`claimManager` addresses as (network calls to the indexer, on-chain read targets,
etc.) to confirm they match the new addresses, not the old ones.

---

## Step 5 — End-to-end UAT verification (per the builder ticket's acceptance criteria)

Only after all of steps 1–4 are verified independently:
1. Run a paying draw end-to-end on UAT.
2. Confirm a non-opted-out winner's `principalOf` grew by the prize amount and a fresh tranche
   opened at tenure 0 (query the vault / indexer, not just the UI).
3. Confirm points derive on that tranche at the base multiplier (no inherited multiplier from an
   older tranche).
4. Confirm the frontend shows the "you won — automatically restaked" surfacing.
5. Confirm an opted-out wallet (`claimManager.setCompoundOptOut(true)` beforehand) still receives
   MON to wallet, not a vault credit.
6. Then: ADR-0042 scoped review of the new ClaimManager⇄Vault path, and a full UAT re-soak, per
   the builder ticket — before any mainnet plan.

## Rollback

If something is wrong post-redeploy: the OLD `ClaimManagerV5` / `DrawManagerV5` are not
destroyed, just superseded (see `priorAddresses` in the new deployment record). Re-running
`vault.setDrawManager(<old DrawManagerV5 address>)` from the owner key repoints the vault back.
Any distributions already registered against the new `ClaimManagerV5` remain claimable there
independently of which `DrawManagerV5` the vault currently points to — winners are not stranded
either way. Any winners with pre-redeploy deferred claims against the OLD `ClaimManagerV5` must
still claim against that OLD address (its escrow is untouched by this redeploy).

## External dependencies (CLAUDE.md rule 5)

- **Monad testnet RPC** — deploy script and all `cast`/verification calls depend on it; if it's
  down, nothing above can proceed (no on-chain fallback).
- **Fly** (keeper + indexer hosting) — `flyctl deploy`/`flyctl secrets set` require Fly platform
  availability; a Fly outage delays re-pointing but doesn't corrupt state (old config keeps
  running against old addresses).
- **Vercel** (frontend hosting) — same shape of dependency for the frontend re-point.
- **PrizeVaultV5 owner key** — the single point of failure for step 1; if it's lost, the vault can
  never be re-pointed to a new draw manager again (see ADR-0042 for the broader owner-key risk
  discussion).
