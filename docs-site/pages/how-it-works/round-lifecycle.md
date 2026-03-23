# Round Lifecycle

Every EverDraw round moves through four states. Understanding these states tells you exactly what to expect at any point.

---

## State 1 — Open 🟢

**Duration:** 24 hours

The vault is live and accepting deposits. You can buy tickets at any point during this window. Your MON is staked via ShMON immediately on purchase and starts generating yield from the moment you deposit.

The vault UI shows a green progress ring counting down the time remaining. When the timer reaches zero, the vault locks.

**What you can do:** Buy tickets. Multiple purchases in the same round are supported and cumulative.

**What you cannot do:** Withdraw during an open round. Your principal is committed for the duration of the round.

---

## State 2 — Committed

**Duration:** ~10 blocks (seconds)

Sales close. A target block number is recorded on-chain — this is the source of the draw's randomness. The commitment happens in a single keeper transaction immediately after the sales window ends.

A new round opens simultaneously in State 1 so deposits continue flowing into the next vault without interruption.

**What you can do:** Nothing required. This state is automated.

---

## State 3 — Finalizing ⏳

**Duration:** ~7 days

The winner is drawn using the committed block hash. The full prize pool is unstaked from ShMON via the protocol's unstake request. ShMON operates on an epoch-based unstaking queue, and this process takes approximately 7 days to complete.

During finalization, your principal and the prize pool are in the unstaking queue. Nothing is claimable yet. The vault shows a purple ring in the UI.

**What you can do:** Nothing required. Continue depositing into open rounds.

**Why 7 days?** This is a ShMON protocol constraint, not an EverDraw design choice. ShMON's epoch-based unstaking is part of Monad's staking security model. EverDraw's Phase 2 architecture (continuous TWAB deposits) is designed to abstract this wait time away entirely for users.

---

## State 4 — Settled ✅

Unstaking completes. The contract receives the MON back, calculates the prize yield, and makes funds available for withdrawal and claiming.

**What you can do:**
- **Winners:** Claim the yield prize, then withdraw principal
- **Everyone else:** Withdraw principal

Both actions are available from the "Previous Draw" view in the UI.

---

## Round timeline summary

| State | Duration | What's happening |
|---|---|---|
| Open | 24 hours | Ticket sales live |
| Committed | ~10 blocks | Randomness source locked |
| Finalizing | ~7 days | ShMON unstaking queue |
| Settled | Ongoing | Claim / withdraw available |

---

## Multi-vault staggering

EverDraw runs multiple vaults in parallel on a staggered schedule. At any given time, at least one vault is in State 1 (Open) accepting new deposits. This means you never have to wait for a new round to open — there is always somewhere to put your MON to work immediately.
