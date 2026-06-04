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
- Backfill deploy blocks/txs/anchors for V4-A (from original logs) and new V4-B.

## What stays live and correct throughout

- **V4-A is untouched and fully correct.** Users keep using Vault A the whole time.
- The only gap: Vault B is unavailable from now until Saturday ~18:10 UTC (~3 days). Acceptable — it had zero users.

## Why not the cheaper options

- **Delayed-skip re-anchor (no redeploy):** would keep B's address but requires pausing B, reconfiguring the keeper to NOT auto-skip B's empty round for 3.5 days, then unpause+skip at exactly the right moment. Fragile; one keeper misfire re-anchors B to the wrong time. Rejected for a one-time launch.
- **Accept the 55-min gap:** permanently off-spec, degrades the two-vault product (ADR-0010 line 11: "the 3.5-day offset breaks, and we get questions we can't answer"). No reason to accept it when the fix is free pre-deposit.

## Lesson captured

The launch doc's timing guidance contradicted ADR-0010 and wasn't checked against it before going to the builder. Added to the multi-surface discipline: **deploy-timing/cadence is a spec-governed parameter — every redeploy ticket must cite the ADR-0010 anchor and the exact target timestamp, not "whenever convenient."** This is now noted in ADR-0032 and the corrected launch doc.
