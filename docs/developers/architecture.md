# Architecture

EverDraw has four components. The smart contract is the source of truth. Everything else reads from it.

---

## Prize vault contract

Solidity contract `TicketPrizePoolShmonV2`. One instance per vault. Two are deployed on Monad mainnet, on offset weekly schedules.

Responsibilities:

- Accepts MON or shMON, issues tickets
- Holds deposits as shMON shares (no internal unstaking, ever)
- Manages round state (Open, Committed, Settled, Skipped, Failed)
- Runs the commit reveal draw using a Monad block hash
- Tracks per user principal per round
- Returns shMON on withdraw and pays the prize on claim
- Exposes a Merkl readable position surface for shMonad's points indexer

Design choices:

- Single contract, no proxy. Smaller attack surface and no upgrade keys.
- All round state on chain. No off chain indexer needed for correctness.
- Per round per address principal accounting. No cross round entanglement.
- Block hash randomness. No oracle dependency.
- `commit` and `settle` are public. Anyone can advance the lifecycle. The keeper is convenience.

---

## Keeper

Off chain service that polls `nextExecutable()` and submits the corresponding transaction. Two responsibilities specific to V2:

- **Anchor gate.** Even when the contract reports `Commit` is eligible, the keeper waits until the configured weekday and time before firing. This is what keeps each vault's deposit window opening on a fixed weekly anchor.
- **Multi pool.** One keeper process services every pool address listed in `POOL_ADDRESSES_V2`, each on its own anchor.

The keeper is not privileged. It can only call public functions. If it goes offline, deposits and round progression pause until it recovers or someone else calls in.

[More on the keeper](keeper-bot.md)

---

## Indexer

A Hono service backed by SQLite. Reads on chain events and exposes HTTP APIs the frontend consumes for participants, history, withdrawal latency metrics, and the EverDraw points system. Pool aware. Multi RPC failover.

The frontend can run without it for live round state (it reads contracts via RPC directly), but historical views, aggregate metrics, and the points page all depend on it.

API documented in [Integration](integration.md#indexer-api). Points formula and tier ladder are defined in [Points](../how-it-works/points.md).

---

## Frontend

React app at [everdraw.xyz](https://everdraw.xyz).

- Real time round state per vault (price, TVL, your position, countdown)
- Buy with MON or shMON
- Previous draw view per pool
- Claim and withdraw flows
- 30 second buy cutoff before deposit windows close
- Multi pool via `VITE_POOL_ADDRESSES_V2`

---

## CampaignManager (Phase 2)

A second contract that lets any Monad protocol fund a branded prize campaign without changes to their own infrastructure. Out of scope for Phase 1. See [Phase 2](../vision/phase-2.md).

---

## Data flow

```
User wallet ──► Frontend ──► Vault contract ──► shMON
                                ▲
                                │
                            Keeper bot
                                │
Indexer ────────────────────────┘ (read events)
```

The frontend reads contract state directly via RPC. The indexer follows events independently and is not on the write path.
