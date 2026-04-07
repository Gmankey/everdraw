# D5 Readiness Pack — ShMonad Address Unblock

**Date:** 2026-03-02  
**Project:** Everdraw  
**Blocker:** Mainnet ShMonad address not finalized

## Goal
Be deploy-ready so only one variable remains: `SHMONAD_MAINNET_ADDRESS`.

## Required deployment inputs
- [ ] `TICKET_PRICE_MON` (locked: `1`)
- [ ] `COMMIT_DELAY_BLOCKS` (locked: `10`)
- [ ] `ROUND_DURATION_SEC` (locked: `604800`)
- [ ] `SHMONAD_MAINNET_ADDRESS` (**pending D5 confirmation/signoff**)
- [ ] Keeper wallet address funded
- [ ] RPC endpoint(s) for mainnet

## Official shMonad addresses (source: https://docs.shmonad.xyz/addresses)
- **Mainnet shMON:** `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`
- **Testnet shMON:** `0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9`

> Note: Keep PM signoff for final mainnet deployment params even when official docs list the address.

## Pre-deploy validation plan (once address arrives)
1. Verify address bytecode is non-empty.
2. Verify ABI compatibility against expected methods:
   - `deposit(uint256,address) payable returns (uint256)`
   - `requestUnstake(uint256) returns (uint64)`
   - `completeUnstake()`
3. Execute tiny-value smoke flow on mainnet fork/sandbox:
   - buy ticket → commit → draw → settle path simulation
4. Confirm no revert mismatches on payable deposit and unstake finalize.

## Commands template
```bash
# fill env first
export RPC_URL_MAINNET="..."
export SHMONAD_MAINNET_ADDRESS="0x..."

# sanity check code exists
cast code "$SHMONAD_MAINNET_ADDRESS" --rpc-url "$RPC_URL_MAINNET"
```

## Risk controls
- Keep deploy script immutable except address input.
- Two-person review before final deploy transaction.
- Keep keeper in dry-run first 15–30 min on mainnet, then live.

## Exit criteria for D5
- [ ] Address received and verified
- [ ] ABI compatibility confirmed
- [ ] Deploy checklist signed by PM
- [ ] Gate D approved
