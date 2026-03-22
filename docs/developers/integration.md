# Integration Guide

## Reading round data

Poll `getRoundInfo(currentRoundId())` for live round state. The return struct contains everything needed to display the current round: state, sales end time, total tickets, total principal, winner, and prize data.

```javascript
const roundId = await pool.currentRoundId()
const info = await pool.getRoundInfo(roundId)

// info.state: 0=Open 1=Committed 2=Finalizing 3=Settled
// info.salesEndTime: unix timestamp
// info.totalTickets: total tickets sold
// info.totalPrincipalMON: sum of all deposits in wei
// info.winner: address(0) if not yet drawn
// info.yieldMON: prize amount in wei (available after settlement)
```

## Checking user position

```javascript
const principal = await pool.principalMON(roundId, userAddress)
// Returns the user's deposited MON in wei for this round
// 0 if the user has not participated
```

## Listening for events

```javascript
pool.on('TicketsBought', (roundId, buyer, ticketCount, monPaid) => {
 // Update UI with new ticket purchase
})
```

## Multi-pool support

EverDraw supports multiple concurrent pool addresses. Pass a comma-separated list via `VITE_POOL_ADDRESSES` to enable the multi-vault staggered view in the frontend.

## ABI

The full ABI is available on the verified contract page on MonadVision and in the repository at `out/TicketPrizePoolShmonShMonad.sol/TicketPrizePoolShmonShMonad.json`.
