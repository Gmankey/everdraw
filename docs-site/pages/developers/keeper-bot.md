# Keeper Bot

The keeper is the off-chain service that drives round transitions. Without it, rounds don't advance automatically — but anyone with gas can call the same public functions, so funds are never at risk if it goes offline.

---

## What the keeper does

It polls `nextExecutable()` on each configured vault on a short interval. The function returns the round id and the next pending action; when one is due, the keeper:

1. Runs preflight (simulates the call, checks gas and preconditions).
2. Submits the transaction.
3. Waits for confirmation and reports to its alert channel.
4. Retries on the next poll if it failed.

Action types (`nextAction` / `nextExecutable`):

- **Commit (2).** Fired when the deposit window and lock have both ended on a round with tickets. Requests randomness and opens the next round.
- **Finalize (3).** Fired once randomness has been delivered (round in `Drawn`). Computes the winner(s) and settles.
- **Skip (1).** Fired on a round that closed with zero tickets. Settles it with no draw.
- **None (0).** Nothing to do this tick.

Because randomness arrives via an async oracle callback, commit and finalize are two separate steps a few seconds to minutes apart.

---

## Cadence

Each vault opens its next round automatically the moment the current one settles, so a vault's weekly anchor is set by its deploy time and preserved as long as rounds progress on schedule. The protocol runs vaults on staggered anchors so draws are spread across the week (the stagger invariant is pinned in ADR-0010). There is no special weekday/time gating in the keeper for V4 — it simply executes whatever `nextExecutable` reports as due.

If a round's randomness callback never arrives, the keeper should **alert** rather than act: force-settling is an owner-only action (`emergencyForceSettle`) and a human decision.

---

## Reliability

- Auto-restart on crash (no state is held off-chain; everything is on the contract)
- Multi-RPC failover (primary + fallback RPC)
- Low-balance alert (keeper wallet must hold gas)
- VRF-reserve alert: each vault pays a randomness fee per commit from its own native balance; alert when that reserve runs low so the owner can top it up
- Consecutive-error and uncaught-exception alerts
- Governance-event alerts (ownership/pauser/oracle/stop changes) so any unexpected admin action is visible immediately

---

## Configuration

The keeper takes a set of vault addresses to service plus RPC, signer, and alert configuration. Canonical production config lives in the hosting platform's secrets (not in the repo); the current vault addresses are in [`deployments/monad-mainnet.json`](https://github.com/Gmankey/everdraw/blob/staging/deployments/monad-mainnet.json). Secrets are never committed.

---

## Non-privileged

The keeper cannot access user funds, modify contract parameters, or override draws. It only calls the public lifecycle functions (`commitDraw`, `finalizeDraw`, `skipRound`, `executeNext`). The contract is the source of truth.
