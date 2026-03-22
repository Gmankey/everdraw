# Architecture

EverDraw consists of three core components and one upcoming module. Each is independently deployable and maintained.

---

## Smart contract — Prize Vault

The core protocol logic lives in a single Solidity contract: `TicketPrizePoolShmonShMonad.sol`.

**Responsibilities:**
- Accepts MON deposits and issues tickets
- Stakes deposited MON via ShMON
- Manages round state transitions (Open → Committed → Finalizing → Settled)
- Executes the commit-reveal draw mechanism
- Tracks per-user principal balances
- Processes unstaking from ShMON
- Distributes prize yield and returns principal on claim/withdraw

**Key design decisions:**
- Single contract, no proxy pattern — reduces attack surface and upgrade complexity
- All round state is stored on-chain — no off-chain indexer required to determine round outcomes
- Principal tracking is per-round per-address — no cross-round state entanglement
- Block hash randomness — no oracle dependency for draws
- `executeNext()` — a single public function that advances the round lifecycle. Anyone can call it. The keeper is a convenience, not a dependency.

---

## CampaignManager (Phase 2)

A second contract that enables protocol-funded prize campaigns.

**Responsibilities:**
- Accept campaign creation from any protocol (`createCampaign()`)
- Hold campaign funds in escrow
- Verify eligibility via on-chain snapshots or Merkle proofs
- Execute draws on the campaign schedule
- Manage winner claims

The CampaignManager is independent from the core prize vault. Yield-driven vaults and campaign-funded vaults operate on the same infrastructure but through separate contract interfaces.

---

## Keeper bot

An automated off-chain service that monitors the contract and calls state-transition functions at the correct times.

**Responsibilities:**
- Monitor `nextExecutable()` to determine what action is due
- Execute state transitions (commit, draw, settle, skip) via `executeNext()`
- Preflight safety checks before each transaction (simulates the call, checks gas, verifies state preconditions)
- Telegram alerting for all actions, errors, and anomalies
- systemd service management for reliability and auto-restart

The keeper is non-privileged — it cannot access user funds or modify contract state beyond the defined state transitions. Any wallet can call `executeNext()`. The keeper simply ensures it's called reliably and on schedule. If the keeper goes down, rounds pause until it recovers or someone else calls the function — but no funds are at risk.

---

## Frontend

A React application that provides the user interface for all protocol interactions.

**Responsibilities:**
- Real-time round state display (price, TVL, your position, countdown)
- Ticket purchasing with automatic network switching
- Previous draw results and participant table
- Prize claiming and principal withdrawal
- Multi-pool support via `VITE_POOL_ADDRESSES`

---

## Data flow

```
User → Frontend → Prize Vault → ShMON
 ↑
 Keeper Bot

Protocol → CampaignManager → Draw + Claims
```

The frontend reads contract state directly via RPC (no subgraph dependency in the current architecture). The keeper monitors contract state independently and submits transactions on schedule.
