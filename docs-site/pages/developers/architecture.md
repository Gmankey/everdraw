# Architecture

EverDraw has four components. The smart contract is the source of truth; everything else reads from it.

---

## Prize vault contract

Solidity contract `TicketPrizePoolV4`. One instance per vault; the protocol runs more than one vault on staggered schedules.

Responsibilities:

- Accepts deposits (native MON or an ERC-20, per the vault's `depositMode`), issues tickets
- Holds deposits as ERC-4626 shares in a yield vault (shMON in production) — no internal unstaking
- Manages round state (Open, AwaitingVRF, Drawn, Settled)
- Runs a verifiable draw via a pluggable randomness oracle (Pyth Entropy adapter in production), supporting one or multiple winners
- Accepts sponsor contributions that earn yield alongside the round
- Routes an optional, capped protocol fee on yield to up to 8 recipients (snapshotted per round)
- Tracks per-user, per-round principal; returns shares on withdraw and pays prizes on claim
- Wraps every payout so a failed transfer defers to a retriable pending claim rather than freezing settlement
- Exposes a Merkl-readable, non-transferable position surface for shMonad's points indexer

Design choices:

- Single contract, no proxy — smaller attack surface, no upgrade keys. New generations are fresh deploys.
- All round state on-chain; no off-chain indexer needed for correctness.
- Per-round, per-address principal accounting — no cross-round entanglement.
- Randomness via an external verifiable oracle, swappable behind a 24h timelock.
- `commitDraw` / `finalizeDraw` / `skipRound` / `executeNext` are public — anyone can advance the lifecycle. The keeper is convenience.
- Pauser is a role distinct from owner; it can halt new deposits but never claims or withdrawals.

[Contract reference →](smart-contract.md)

---

## Keeper

Off-chain service that polls `nextExecutable()` and submits the corresponding transaction (commit, finalize, or skip). It services every configured vault. The keeper is **not privileged** — it can only call public functions, and if it goes offline, anyone can advance rounds; funds are never at risk. Randomness has a built-in timeout so no round can stick.

[More on the keeper →](keeper-bot.md)

---

## Indexer

A service backed by SQLite. It follows on-chain events and exposes HTTP APIs the frontend consumes for participation history, aggregate metrics, and the EverDraw points system. Vault-aware, with multi-RPC failover.

The frontend can run without it for live round state (it reads contracts directly via RPC), but historical views, aggregates, and the points page depend on it.

API documented in [Integration](integration.md#indexer-api). Points formula and tiers are in [Points](../how-it-works/points.md).

---

## Frontend

React app at [everdraw.xyz](https://everdraw.xyz).

- Real-time round state per vault (price, TVL, your position, countdown)
- Deposit, sponsor, claim, and withdraw flows
- Previous-draw view per vault, including multi-winner results
- Pending-claims retry banner (driven by `hasPendingClaims`)
- Buy cutoff before deposit windows close; closed-state rendering for paused/stopped vaults

---

## Data flow

```
User wallet ──► Frontend ──► Vault contract ──► yield vault (shMON)
                                ▲   │
                                │   └──► randomness oracle (Pyth)
                            Keeper bot
                                │
Indexer ────────────────────────┘ (read events)
```

The frontend reads contract state directly via RPC. The indexer follows events independently and is never on the write path.

---

## Campaigns and partner prizes (roadmap)

Sponsored prizes are live today via `sponsor()`. Richer partner-campaign tooling (a CampaignManager that lets any protocol fund branded prize campaigns) is on the roadmap — see [Vision](../vision/index.md).
