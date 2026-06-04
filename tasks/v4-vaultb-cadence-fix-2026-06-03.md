# V4-B Cadence Fix — Redeploy for Correct 3.5-Day Stagger

**Date:** 2026-06-03
**Cause:** PM launch doc (`v4-mainnet-launch-kickoff-2026-06-03.md`) gave contradictory deploy-timing guidance; builder deployed V4-A and V4-B ~55 minutes apart. ADR-0010 requires the two vaults' anchors to be offset by **exactly 3.5 days**. The current deployment violates that invariant.
**Decision:** Redeploy V4-B at the correct offset. (Operator chose this over delayed-skip re-anchor and over accepting the 55-min gap.)
**Safe because:** `totalSupply() == 0` on both vaults — zero deposits, zero users affected.

## The numbers

| | Time (UTC) |
|---|---|
| V4-A deploy | Wed Jun 3 06:10:23 |
| V4-A round-1 salesEnd (draw anchor) | Thu Jun 4 06:10:23 |
| **Current** V4-B round-1 salesEnd | Thu Jun 4 07:05:22 (~55 min after A — WRONG) |
| **Target** V4-B redeploy | **Sat Jun 6 18:10:23 UTC** (84h = 3.5 days after V4-A deploy) |
| Target V4-B round-1 salesEnd | Sun Jun 7 18:10:23 (3.5 days after A's Thu anchor — CORRECT) |

Precision to the minute isn't critical; anywhere within ~Sat 18:00–18:30 UTC keeps the stagger clean. Don't drift more than a few hours.

## Addresses

| | Address |
|---|---|
| V4-A (KEEP — cadence is fine) | `0x9263d84a141172d9618f4b08839f595EE03bC7E8` |
| V4-B current (RETIRE) | `0x0032c9F6621Ef5d53b48dc602D4d056d7a47c5fF` |
| V4-B current oracle (retire with it) | `0x1ee7502bd22940523ae504df9855abc0c417347d` |
| V4-B NEW | `0x____________` (Saturday) |
| Owner/pauser (Ledger) | `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2` |
| Keeper (Fly) | `0x80dE4674dEFC68F06F4772B8Ec2F89aBda43DBE9` |

## STATUS (2026-06-03, updated live)

- ✅ **Step 1 DONE** — V4-B paused. Tx `0x1889f67c207fb8bd607413226dfec7ab9d0982067036d30ff70fd45bf7d5e35d`. Signed by Ledger `0xd399…84A2`. `paused() == true` verified on-chain. No deposits possible.
- ✅ **Step 2 DONE** — 9 MON VRF reserve recovered to Ledger. Tx `0x734b70adf1203179fcb49d86b451624e88ea014b6da4f9411c783fabe067991d`. V4-B balance now 0; Ledger ~11.99 MON.
- ⏳ Step 3+ — Saturday Jun 6 ~18:10 UTC redeploy. Pending.
- ⏳ Frontend: hide Vault B tab (builder, when back). Belt-and-suspenders only — on-chain pause already blocks deposits.

---

## Step 1 — NOW: protect the doomed V4-B (prevent any deposit)

A deposit into the current V4-B before Saturday would force a migration. Block it on-chain immediately.

**Operator, from Ledger (MetaMask → Monad explorer write tab on `0x0032c9F6…`):**
```
pause()
```
Verify: `cast call 0x0032c9F6621Ef5d53b48dc602D4d056d7a47c5fF 'paused()(bool)'` → true.

`buyTickets` and `sponsor` are `whenNotPaused`, so this fully blocks new money. Claims/withdraws stay open (irrelevant here — nothing deposited).

**Builder, frontend:** hide the V4-B tab (or label it "Opening Sat Jun 6 18:10 UTC") so users only interact with V4-A until Saturday. Simplest: drop the second address from `VITE_POOL_ADDRESSES` temporarily so only V4-A shows, OR add a "coming soon" state for Vault B. On-chain pause is the safety net regardless.

## Step 2 — NOW or anytime before Saturday: recover the stranded VRF reserve

Current V4-B holds 9 MON VRF reserve. Recover it to the Ledger to fund Saturday's redeploy (Ledger only has ~2 MON left after the initial deploy).

**Operator, from Ledger on `0x0032c9F6…`:**
```
withdrawVRFReserve(9000000000000000000)   // 9 MON in wei
```
(Owner-only, sends to caller = Ledger. `withdrawVRFReserve` is `nonReentrant` and pays `msg.sender`.)

Verify Ledger balance increases by ~9 MON. Now the Ledger has ~11 MON — enough for Saturday's deploy gas + 9 MON reseed.

## Step 3 — Saturday Jun 6, ~18:10 UTC: redeploy V4-B

Same procedure as the original launch ([v4-mainnet-launch-kickoff-2026-06-03.md](v4-mainnet-launch-kickoff-2026-06-03.md) Steps 3–7), V4-B only:

1. **Operator** sends ~10 MON from Ledger to a fresh throwaway deployer EOA (builder generates it). Verify recipient on Ledger device.
2. **Builder** runs the deploy with `VAULT_SYMBOL="EVRDRAW-B"` at ~18:10 UTC:
   ```bash
   export VAULT_SYMBOL="EVRDRAW-B"
   npx hardhat run scripts/deploy-ticket-prize-pool-v4.js --network monadMainnet \
     | tee logs/v4-b-redeploy-$(date -u +%Y%m%dT%H%M%SZ).log
   ```
   Record new V4-B address, new oracle address, deploy block, tx hash, and **round-1 RoundStarted timestamp (the new anchor — confirm it's ~Sat 18:10).**
3. Verify on-chain (same checklist as V4-A): VERSION 4.0.0, ticketPriceAsset 1 MON, numWinners 1, yieldVault shMON, oracle.consumer == new vault, round 1 Open.
4. Seed VRF reserve: `depositVRFReserve()` with 9 MON.
5. `setKeeper(0x80dE…DBE9, true)`, `setKeeper(deployer, false)`.
6. `setPauser(Ledger)`, `transferOwnership(Ledger)`.
7. **Operator** `acceptOwnership()` from Ledger. Verify new V4-B address on device.
8. Builder destroys the Saturday deployer key, returns leftover MON to Ledger.

## Step 4 — Saturday: cut over to the new V4-B

1. **Frontend:** set `VITE_POOL_ADDRESSES` second slot to the NEW V4-B address (Vercel prod env, not local). Redeploy. Verify everdraw.xyz shows both V4-A and the new V4-B, both with 1 MON price.
2. **Keeper Fly secret:** `flyctl secrets set V4_B_ADDRESS=<new> --app everdraw-keeper` (NO `--stage`).
3. **Indexer Fly secret:** `flyctl secrets set V4_B_ADDRESS=<new> V4_B_DEPLOY_BLOCK=<block> --app everdraw-indexer` (NO `--stage`).

## Step 5 — Saturday: retire the old V4-B

Old V4-B (`0x0032c9F6…`) has zero deposits and its reserve withdrawn. Mark it dead:

1. **Operator** from Ledger: `stop()` on `0x0032c9F6…` (one-way; freezes it permanently). Confirms intent on-chain.
2. Record it as retired in `deployments/monad-mainnet.json` and ADR-0032.

## Step 6 — Update records

- `deployments/monad-mainnet.json`: replace the V4-B entry's address with the new one; add the old one as `status: "retired-cadence-error"`.
- ADR-0032: update V4-B address, add a note pointing to this remediation and ADR-0010.
- Backfill deploy blocks/txs/anchors for the new V4-B (from the redeploy log).

---

## Step 7 — Finalize the new V4-B (PROVEN RECIPE — same as V4-A, do not re-investigate)

Everything below was validated end-to-end during the V4-A launch. Substitute `<NEW_V4B>` and `<NEW_V4B_ORACLE>` and run exactly.

### 7a. Verify the contracts on-chain (independent of any report)

```bash
RPC=https://rpc.monad.xyz
cast call <NEW_V4B> 'VERSION()(string)' --rpc-url $RPC                 # "4.0.0"
cast call <NEW_V4B> 'symbol()(string)' --rpc-url $RPC                  # "EVRDRAW-B"
cast call <NEW_V4B> 'owner()(address)' --rpc-url $RPC                  # 0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2
cast call <NEW_V4B> 'pauser()(address)' --rpc-url $RPC                 # same Ledger
cast call <NEW_V4B> 'ticketPriceAsset()(uint256)' --rpc-url $RPC       # 1000000000000000000
cast call <NEW_V4B> 'getRoundState(uint256)(uint8)' 1 --rpc-url $RPC   # 0 (Open)
cast call <NEW_V4B_ORACLE> 'consumer()(address)' --rpc-url $RPC        # == <NEW_V4B>
cast balance <NEW_V4B> --rpc-url $RPC                                  # ~9 MON VRF reserve
```

### 7b. Verify source on the explorer (Sourcify via Foundry — NO API key, NO constructor args)

The `monadexplorer.com` "Verify Code" UI is **Sourcify-based** — it is a `forge` command, not a file upload. Foundry must be installed (`curl -L https://foundry.paradigm.xyz | bash && foundryup`). `foundry.toml` already matches the deploy (solc 0.8.33 / optimizer 200 / viaIR / paris), so bytecode matches.

```bash
# New V4-B pool
forge verify-contract \
  --rpc-url https://rpc.monad.xyz \
  --verifier sourcify \
  --verifier-url 'https://sourcify-api-monad.blockvision.org/' \
  --chain-id 143 \
  <NEW_V4B> \
  src/TicketPrizePoolV4.sol:TicketPrizePoolV4

# New V4-B oracle
forge verify-contract \
  --rpc-url https://rpc.monad.xyz \
  --verifier sourcify \
  --verifier-url 'https://sourcify-api-monad.blockvision.org/' \
  --chain-id 143 \
  <NEW_V4B_ORACLE> \
  src/PythRandomnessOracle.sol:PythRandomnessOracle
```

If forge errors with `Failed to deserialize response`, append `/api` to the verifier-url.

**Confirm verification independently** (don't trust forge output alone):
```bash
curl -s 'https://sourcify-api-monad.blockvision.org/v2/contract/143/<NEW_V4B>'
curl -s 'https://sourcify-api-monad.blockvision.org/v2/contract/143/<NEW_V4B_ORACLE>'
# Expect: "creationMatch":"match","runtimeMatch":"match","match":"match"
```
(The legacy `check-all-by-addresses` endpoint may say `partial`; the authoritative v2 endpoint says full `match`. Trust v2.)

### 7c. Deployer key handling (avoid the V4-A near-miss)

- The Saturday deployer key **must be saved** during deploy (e.g. `.openclaw/secrets/v4b-redeploy-<date>.txt`) so leftover funds are recoverable. The V4-A throwaway key was nearly lost with 10.4 MON on it.
- After deploy + role rotation, **sweep the deployer's residual balance back to the Ledger**, then **delete the key file**. A saved mainnet key with no remaining purpose is an attack surface.

### 7d. Manifest + ADR backfill (same fields as V4-A)

New V4-B manifest entry must carry: `address`, `randomnessOracle`, `deployBlock`, `deployTx`, oracle `deployTx`+`deployBlock`, `round1SalesEndAt` + `anchor` (should be ~Sun 18:10 UTC — confirm it's 3.5 days off V4-A's Thu 06:10), `runtimeBytecodeSha256`, and `verification` block (sourcify match + matchId). Mark old `0x0032c9F6…` as `status: "retired-cadence-error"`. Update ADR-0032 + ADR-0033 with the new address.

### 7e. Cut over frontend / keeper / indexer

- Frontend: set `VITE_POOL_ADDRESSES` second slot to `<NEW_V4B>` (Vercel prod env, **not** local). Redeploy. Confirm `everdraw.xyz` shows Vault B Open with the green ring + working buy (no longer the paused "Vault Closed" graphic). Hard-refresh to clear the cached bundle.
- Keeper: `flyctl secrets set V4_B_ADDRESS=<NEW_V4B> --app everdraw-keeper` (**no `--stage`**).
- Indexer: `flyctl secrets set V4_B_ADDRESS=<NEW_V4B> V4_B_DEPLOY_BLOCK=<block> --app everdraw-indexer` (**no `--stage`**).

### 7f. Merkl — submit Vault B (was deferred at launch)

V4-B was intentionally held back from the Merkl form because the old address was being retired. Now submit the **new** V4-B address using `tasks/v4-merkl-submission-2026-06-02.md`. Wait until ≥1 deposit exists on the new V4-B so `totalSupply > 0`. Same Merkl-readable surface as V4-A.

### 7g. Retire the old V4-B

Operator `stop()` on `0x0032c9F6…` from the Ledger via Remix (IV4 interface → At Address → `stop`). It's already paused and drained; `stop()` makes the retirement explicit and one-way.

---

## V4-B done checklist (everything that was done for V4-A)

- [ ] New V4-B + oracle deployed at the 3.5-day anchor (~Sun 18:10 UTC)
- [ ] On-chain config verified (7a)
- [ ] Both contracts Sourcify-verified, confirmed via v2 API (7b)
- [ ] Deployer residual swept to Ledger, key file deleted (7c)
- [ ] Manifest + ADR-0032/0033 updated with new address (7d)
- [ ] Frontend/keeper/indexer cut over, no `--stage` (7e)
- [ ] Merkl Vault B submitted after first deposit (7f)
- [ ] Old V4-B `stop()`ed and marked retired (7g)

## What stays live and correct throughout

- **V4-A is untouched and fully correct.** Users keep using Vault A the whole time.
- The only gap: Vault B is unavailable from now until Saturday ~18:10 UTC (~3 days). Acceptable — it had zero users.

## Why not the cheaper options

- **Delayed-skip re-anchor (no redeploy):** would keep B's address but requires pausing B, reconfiguring the keeper to NOT auto-skip B's empty round for 3.5 days, then unpause+skip at exactly the right moment. Fragile; one keeper misfire re-anchors B to the wrong time. Rejected for a one-time launch.
- **Accept the 55-min gap:** permanently off-spec, degrades the two-vault product (ADR-0010 line 11: "the 3.5-day offset breaks, and we get questions we can't answer"). No reason to accept it when the fix is free pre-deposit.

## Lesson captured

The launch doc's timing guidance contradicted ADR-0010 and wasn't checked against it before going to the builder. Added to the multi-surface discipline: **deploy-timing/cadence is a spec-governed parameter — every redeploy ticket must cite the ADR-0010 anchor and the exact target timestamp, not "whenever convenient."** This is now noted in ADR-0032 and the corrected launch doc.
