# Integration Guide

## Reading round data

```javascript
const roundId = await pool.currentRoundId()
const info = await pool.getRoundInfo(roundId)

// info.state              0 Open, 1 Committed, 2 Settled, 3 Skipped, 4 Failed
// info.salesEndTime       unix timestamp deposit window closes
// info.targetBlockNumber  block whose hash is the random source (set on commit)
// info.totalTickets       tickets sold in this round
// info.totalPrincipalMON  sum of MON principal in wei
// info.totalShmonShares   shMON shares held against that principal
// info.prizeShares        prize in shMON shares (set on settle)
// info.shareRateAtSettle  shMON share rate at settlement
// info.winner             address(0) until settled
// info.winningTicket      ticket index of the winner
// info.prizeClaimed       true after the winner claims
```

## Checking a user position

```javascript
const [principalMON, shmonShares] = await pool.getUserPosition(roundId, userAddress)
const withdrawable             = await pool.getWithdrawableShares(roundId, userAddress)
```

`withdrawable` is the shMON share amount the user receives from `withdrawPrincipal`, accounting for prize allocation if the round has settled.

## Listening for events

```javascript
pool.on('TicketsPurchased', (roundId, buyer, ticketCount, costMON, shares, shareRate, depositAsset) => {
  // depositAsset: 0 MON, 1 shMON
})

pool.on('RoundSettled', (roundId, winner, winningTicket, ...rest) => {
  // pull info via getRoundInfo for the rest
})
```

## Multi pool

EverDraw runs two pool addresses in parallel on offset weekly anchors. The frontend reads `VITE_POOL_ADDRESSES_V2` (comma separated). The keeper reads `POOL_ADDRESSES_V2` and uses `POOL_SCHEDULE_V2` to gate when each pool can fire its commit transaction.

```
VITE_POOL_ADDRESSES_V2=0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888,<vaultB>
POOL_ADDRESSES_V2=0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888,<vaultB>
POOL_SCHEDULE_V2=0x2208…7888:Wed:13,<vaultB>:Sun:01
```

When integrating against a single pool, pin to the contract address. State is fully scoped per pool.

## Merkl indexing

Both pools emit `Deposit(address indexed recipient, uint256 amount)` on every ticket purchase and `Withdraw(address indexed recipient, uint256 amount)` on every principal withdrawal. `balanceOf(user)` and `totalSupply()` follow standard ERC20 read semantics. The position is non transferable. See [Smart Contract](smart-contract.md#merkl-readable-position-surface) for the full surface.

## ABI

`out/TicketPrizePoolShmonV2.sol/TicketPrizePoolShmonV2.json` in the repo, or the verified contract page on MonadVision.
