# Integration Guide

EverDraw exposes two interfaces. The vault contract for on chain state, and the indexer API for derived state (participation history, points, leaderboards). Use the contract for ground truth, use the indexer for anything that would otherwise require scanning logs.

---

## Reading round data from the contract

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

EverDraw runs two vaults in parallel on offset weekly anchors (Wed and Sun). V3 is the current contract; V2 vaults remain active for in-flight finalization during the V3 migration. Three frontend env vars are now in play:

```
# V3 vaults — current production
VITE_POOL_ADDRESSES_V3=0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee
# (Vault B V3 added here after the 2026-05-31 deploy)

# V2 vaults — still active for finalization
VITE_POOL_ADDRESSES_V2=0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888,0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d

# shMON address (used by frontend for previewRedeem of V3 prize shares)
VITE_SHMON_ADDRESS=0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c
```

Keeper env (canonical config lives in Fly secrets for the `everdraw-keeper` app, not local files):

```
POOL_ADDRESSES=0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888,0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d,0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee
POOL_ADDRESSES_V2=0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888,0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d
POOL_ADDRESSES_V3=0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee
POOL_SCHEDULE_V2=0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d:Sun:1
POOL_SCHEDULE_V3=0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee:Wed:13
```

The keeper auto-routes by inspecting which list each pool address appears in. V2 Vault A is in `POOL_ADDRESSES` (so the keeper still finalizes its existing rounds) but no longer in `POOL_SCHEDULE_V2` (so no new V2 Vault A rounds start). The Wed anchor now belongs to V3 Vault A.

The canonical address list including runtime bytecode hashes and constructor args is at [`deployments/monad-mainnet.json`](https://github.com/Gmankey/everdraw/blob/staging/deployments/monad-mainnet.json).

When integrating against a single pool, pin to the contract address. State is fully scoped per pool.

## Merkl indexing

Both pools emit `Deposit(address indexed recipient, uint256 amount)` on every ticket purchase and `Withdraw(address indexed recipient, uint256 amount)` on every principal withdrawal. `balanceOf(user)` and `totalSupply()` follow standard ERC20 read semantics. The position is non transferable. See [Smart Contract](smart-contract.md#merkl-readable-position-surface) for the full surface.

## ABI

`out/TicketPrizePoolShmonV2.sol/TicketPrizePoolShmonV2.json` in the repo, or the verified contract page on MonadVision.

---

## Indexer API

Base URL: `https://everdraw-indexer.fly.dev`

The indexer is multi pool aware and follows on chain events with a few seconds of lag. CORS is open. All responses are JSON.

### Rounds

```
GET /api/rounds?pool=<address>&limit=20
GET /api/rounds/:roundId?pool=<address>
GET /api/rounds/:roundId/participants?pool=<address>
```

The `pool` query parameter is required when more than one pool is being indexed. Without it, the legacy single pool form is used and may merge data across pools.

### Wallet history

```
GET /api/wallets/:wallet/rounds?limit=50
```

Returns every round the wallet participated in across all pools, sorted newest first. Includes settled outcome (won or not), principal, prize if any, withdraw timestamp.

### Points

The points endpoints back the profile page and leaderboard.

```
GET /api/points/:wallet
```

Returns:

```json
{
  "wallet": "0x...",
  "ens": null,
  "lifetime_points": 0,
  "current_streak_weeks": 0,
  "longest_streak_weeks": 0,
  "current_multiplier_x100": 100,
  "current_tier": "Bronze",
  "consecutive_non_wins": 0,
  "highest_streak_milestone_awarded": 0,
  "has_received_first_deposit_bonus": 0,
  "has_received_first_win_bonus": 0,
  "next_tier_threshold": 4,
  "next_milestone": 4,
  "rank": 1
}
```

```
GET /api/points/:wallet/history?limit=12
```

Returns an array of per round point awards with the breakdown:

```json
[
  {
    "pool_address": "0x...",
    "round_id": 28,
    "base_points": 2,
    "multiplier_x100": 100,
    "bonuses_breakdown": {},
    "total_points": 2,
    "awarded_at_unix": 1746724800
  }
]
```

```
GET /api/leaderboard?limit=100&period=all
GET /api/leaderboard?limit=100&period=month
```

```
GET /api/points/preview?wallet=<address>&pool=<address>&tickets=<n>
```

Estimates the points the wallet would earn by buying `n` tickets in the active round of `pool` right now, including the streak multiplier and any applicable both-vaults bonus. Read only, does not write state. Used by the frontend's deposit preview line.

### Multipliers and tiers

The multiplier and tier values returned by the points API match the table in the [Points](../how-it-works/points.md) doc. Consumers should not hard code the ladder, prefer the `current_multiplier_x100` and `current_tier` fields returned by the API, since the ladder may evolve in future phases.

### Health and metadata

```
GET /api/health
```

Returns the indexer's current `latestBlock`, the pool addresses it is following, and the points-start cutoff block (only events at or after this block contribute to points, per ADR-0008).

### Schema notes

- All wallet addresses are returned lowercase.
- `ens` is best effort. If the resolver is slow or unavailable, the field is `null`. Consumers should fall back to the shortened address.
- Timestamps are unix seconds.
- Numeric fields that represent shMON shares or MON wei are decimal strings to avoid JS precision loss.
