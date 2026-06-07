# Integration Guide

EverDraw exposes two interfaces: the vault contract for on-chain ground truth, and the indexer API for derived state (participation history, points, leaderboards). Use the contract for correctness; use the indexer for anything that would otherwise require scanning logs.

---

## Reading round data from the contract

```javascript
const roundId = await pool.currentRoundId()
const info = await pool.getRoundInfo(roundId)

// info.state                 0 Open, 1 AwaitingVRF, 2 Drawn, 3 Settled
// info.salesEndTime          unix timestamp the deposit window closes
// info.requestId             randomness request id (0 until committed)
// info.totalTickets          tickets sold this round
// info.totalPrincipalAsset   sum of principal in asset units (wei)
// info.totalPrincipalShares  yield-vault shares held against that principal
// info.principalSharesAtSettle  set at settlement
// info.totalPrizeShares      prize in yield-vault shares (set at settle)
// info.forfeitBps            unfilled winner allocation returned to depositors (too-few-tickets case)
// info.wasSkipped            true for empty-skip AND VRF-timeout force-settle

// Winners are an ARRAY (a vault may pay multiple positions):
const [winners, winningTickets, prizeShares] = await pool.getRoundWinners(roundId)
```

## Checking a user position

```javascript
const [principalAsset, principalShares] = await pool.getUserPosition(roundId, userAddress)
const hasPending = await pool.hasPendingClaims(userAddress)  // O(1); true if any payout deferred
```

## Listening for events

Key by **topic hash**, not name — earlier protocol generations use differently-shaped events.

```javascript
pool.on('TicketsBought', (roundId, buyer, ticketCount, assetPaid) => { /* ... */ })

pool.on('WinnersDrawn', (roundId, winners, winningTickets, prizeShares) => {
  // arrays — one entry per winning position
})

pool.on('RoundSettled', (roundId, principalShares, prizeShares) => { /* ... */ })

// Deferred payouts — surface a retry path
pool.on('TransferDeferred', (rid, recipient, slot, shares) => { /* prompt claimDeferred */ })
```

See [Smart Contract](smart-contract.md#events) for the full event list.

## Multiple vaults

The frontend and keeper are configured with the current set of vault addresses; each vault's state is fully scoped to its own contract. The **canonical, current address list** (with bytecode hashes and constructor args) is in [`deployments/monad-mainnet.json`](https://github.com/Gmankey/everdraw/blob/staging/deployments/monad-mainnet.json) — read addresses from there rather than hardcoding, since they change across protocol generations. When integrating against a single vault, pin to its address.

## Merkl indexing

Every vault emits `Deposit(address indexed recipient, uint256 amount)` on each ticket purchase and `Withdraw(address indexed recipient, uint256 amount)` on each principal withdrawal. `balanceOf(user)` and `totalSupply()` follow standard ERC-20 read semantics (denominated in the deposit asset). The position is non-transferable. Full surface: [Smart Contract](smart-contract.md#merkl-readable-position-surface).

## ABI

The verified ABI is published with each contract on the Monad explorer (Sourcify), and the artifact is in the repo at `abi/TicketPrizePoolV4.json`.

---

## Indexer API

Base URL: `https://everdraw-indexer.fly.dev`

Vault-aware, follows on-chain events with a few seconds of lag. CORS open. All responses JSON.

### Rounds

```
GET /api/rounds?pool=<address>&limit=20
GET /api/rounds/:roundId?pool=<address>
GET /api/rounds/:roundId/participants?pool=<address>
```

The `pool` query parameter is required when more than one vault is indexed.

### Wallet history

```
GET /api/wallets/:wallet/rounds?limit=50
```

Every round the wallet participated in across all vaults, newest first: settled outcome, principal, prize if any, withdraw timestamp.

### Points

```
GET /api/points/:wallet
GET /api/points/:wallet/history?limit=12
GET /api/leaderboard?limit=100&period=all
GET /api/leaderboard?limit=100&period=month
GET /api/points/preview?wallet=<address>&pool=<address>&tickets=<n>
```

`/api/points/:wallet` returns lifetime points, current streak, multiplier, tier, and the next thresholds. `/preview` estimates points for buying `n` tickets in a vault's active round (read-only). Prefer the returned `current_multiplier_x100` / `current_tier` fields over hardcoding the ladder — it may evolve. Points formula and tiers: [Points](../how-it-works/points.md).

### Health

```
GET /api/health
```

Returns the indexer's latest scanned block, chain head, lag, DB status, and the vaults it's following.

### Schema notes

- Wallet addresses are returned lowercase.
- `ens` is best-effort; may be `null` — fall back to the shortened address.
- Timestamps are unix seconds.
- Share / asset amounts are decimal strings to avoid JS precision loss.
