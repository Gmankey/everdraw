# Round Lifecycle

Every EverDraw round moves through five stages. Understanding these stages tells you exactly what to expect at any point.

---

## Stage 1 — Deposit

**Duration:** 24 hours

The vault is live and accepting deposits. You can buy tickets at any point during this window. Your MON is staked via ShMON immediately on purchase and starts generating yield from the moment you deposit.

The vault UI shows a countdown timer for the time remaining in the deposit window. When the timer reaches zero, the vault locks.

**What you can do:** Buy tickets. Multiple purchases in the same round are supported and cumulative.

**What you cannot do:** Withdraw during an open round. Your principal is committed for the duration of the round.

---

## Stage 2 — Yield Accumulating

**Duration:** ~7 days

Sales close. The vault is locked. All deposited MON remains staked via ShMON, accumulating yield for the prize pool. No new tickets can be purchased for this round.

A target block number is also recorded on-chain during this phase — this is the source of the draw's randomness, committed before the winner is determined.

**What you can do:** Nothing required. Continue depositing into the current open round.

---

## Stage 3 — Winner Revealed

**Duration:** Instant (reveal happens automatically at the 7-day mark)

At the end of the yield period, the winner is drawn using the committed block hash and announced in the UI. The winning address, their ticket count, and the estimated prize are all visible immediately.

The draw is fully on-chain and verifiable. [More on winner selection](winner-selection.md).

**What you can do:** View the winner and participant leaderboard in the Previous Vault tab.

**What you cannot do:** Claim or withdraw yet. The ShMON unstaking phase must complete first.

---

## Stage 4 — Unstaking ShMON

**Duration:** 18-24 hours

The prize pool is unstaked from ShMON via the protocol's unstake request. ShMON operates on an epoch-based unstaking queue — this process takes approximately 18-24 hours to complete.

During this phase, the winner is visible in the UI and a countdown shows the estimated time until funds are available. Claim and withdraw buttons are present but disabled until the countdown reaches zero.

This is a ShMON protocol constraint, not an EverDraw design choice. EverDraw's Phase 2 architecture is designed to abstract this wait time away entirely for users.

**What you can do:** View the winner and results. Track the settlement countdown.

---

## Stage 5 — Claim / Withdraw

Unstaking completes. The contract receives the MON back, calculates the final prize yield, and makes funds available.

**What you can do:**
- **Winners:** Claim the yield prize, then withdraw principal
- **Everyone else:** Withdraw principal

Both actions are available from the Previous Vault tab in the UI.

---

## Round timeline summary

| Stage | Duration | What's happening |
|---|---|---|
| Deposit | 24 hours | Ticket sales live |
| Yield Accumulating | ~7 days | ShMON staking, yield building |
| Winner Revealed | Instant | Draw executed, winner announced |
| Unstaking ShMON | 18-24 hours | ShMON unstaking queue |
| Claim / Withdraw | Ongoing | Prize claim and principal withdrawal available |

**Total round duration: approximately 9 days** (1 day deposit + 7 days yield + ~1 day unstaking)

---

## How rounds sequence

Rounds are sequential — one round runs at a time. Once a round fully settles, the next round opens automatically. The UI always shows the current active vault and the most recently completed vault side by side.

If a round receives no deposits, the keeper skips it and the next round opens immediately with a fresh deposit window.
