# ADR-0015 — VRF Failover Playbook

**Status:** Accepted  
**Date:** 2026-05-22  
**Deciders:** User + Claude  
**Relates to:** [ADR-0014](0014-vrf-launch-requirement-pyth-entropy.md) (provider selection), [ADR-0012](0012-reentrancy-trust-model.md) (shMON trust model)

## Context

[ADR-0014](0014-vrf-launch-requirement-pyth-entropy.md) selected Pyth Entropy as the VRF provider and deferred the failover playbook to this ADR. Before any public mainnet deployment, operations needs documented procedures for the two failure modes the V3 contract exposes:

1. **Pyth callback never arrives** — round stuck in `AwaitingVRF`
2. **VRF reserve depleted** — `_commitDraw` reverts when trying to pay the Pyth fee

Note: the V3 contract uses the **no-unstake design** — `withdrawPrincipal` and `claimPrize` return shMON shares directly via ERC-20 transfer. There is no `Finalizing` state, no `requestUnstake`, and no `completeUnstake`. The "shMON unstake broken" failure mode does not exist in V3.

---

## Contract constants (for reference)

| Constant | Value | Purpose |
|---|---|---|
| `VRF_CALLBACK_TIMEOUT` | 1 hour | After this, `emergencyForceSettle` unlocks for `AwaitingVRF` rounds |

---

## Failure Mode A — Pyth callback never arrives

### What happens

1. Keeper calls `executeNext()` (or `commitDraw(rid)`)
2. Contract emits `VRFRequested(roundId, sequenceNumber, fee)` and enters `AwaitingVRF`
3. Pyth's entropy provider does not call back within `VRF_CALLBACK_TIMEOUT` (1 hour)
4. Round is stuck; no further keeper actions can progress it

### Detection

The keeper event monitor (`scripts/keeper-event-monitor.js`) already alerts when a pool has been in `AwaitingVRF` for more than 1 hour via the `VRF_TIMEOUT_SEC = 3600` threshold. Telegram alert fires: *"⚠️ VRF CALLBACK TIMEOUT: pool 0x... round N stuck in AwaitingVRF for Xm"*.

### Response ladder

**Step 1 — Wait and verify (0–30 min after alert)**

Before acting, confirm the callback genuinely hasn't arrived:
- Check the Pyth Entropy contract on-chain: has `_entropyCallback` been called for the sequence number?
- Check Pyth's own status page / Discord for known outages
- A brief network partition can delay callbacks by minutes; do not escalate immediately

**Step 2 — Re-request attempt (30 min–1 hour)**

If the callback is verified absent:
- Pyth's architecture means the provider must produce the reveal. There is no "retry" at the contract level — the sequence number is fixed.
- Check whether Pyth supports manual reveal via their off-chain API (sequence number + provider commitment). If so, trigger it.
- If Pyth has a published recovery path for stuck requests, follow it first.

**Step 3 — Emergency force settle (after VRF_CALLBACK_TIMEOUT = 1 hour)**

If no callback and no Pyth recovery path within the timeout window:

```bash
cast send $POOL_V3_ADDRESS \
  "emergencyForceSettle(uint256)" $RID \
  --rpc-url $RPC_URL \
  --private-key $OWNER_KEY
```

Effect: round settles with **no winner** and `prizeShares = 0`. Because `prizeShares` stays 0, `withdrawPrincipal` returns each user's **exact deposited share count** (no yield deduction). No yield is distributed.

Emit an announcement to users explaining the round was cancelled and their shMON shares are fully recoverable. Users who want MON can go to shmonad.xyz to unstake their recovered shares.

### Provider failover trigger

A **single callback timeout does not trigger provider failover**. Network hiccups happen. Failover is triggered when:

- **3 or more consecutive rounds** have Pyth callback failures on the same pool, OR
- Pyth publishes an official incident acknowledging the Monad Entropy deployment is broken with no ETA, OR
- The Pyth Entropy contract address on Monad becomes unresponsive (out of gas, paused, etc.)

---

## Failure Mode B — VRF reserve depleted

### What happens

`_commitDraw` calls `entropy.getFee(entropyProvider)` to read the current per-request fee, then pays it from the contract's balance. If `address(this).balance < fee`, the call reverts and the round cannot progress to `AwaitingVRF`.

### Detection

- `commitDraw` / `executeNext(Commit)` reverts with `InsufficientVRFFee`
- The event monitor does not currently alert on low VRF reserve proactively — this is a gap to address post-launch

**Recommended monitoring (ops to add):** Alert when `address(pool).balance < 10 × lastObservedFee`. At typical Pyth fee rates (~fractions of a cent), 0.1 MON covers hundreds of rounds. A 10× buffer gives ample warning.

### Top-up procedure

```bash
cast send $POOL_V3_ADDRESS \
  "depositVRFReserve()" \
  --value 0.1ether \
  --rpc-url $RPC_URL \
  --private-key $OWNER_KEY
```

Only the contract owner can call `depositVRFReserve`. This must be done before the next `commitDraw` can succeed.

### Operational discipline

- After each mainnet deploy, seed at least 0.1 MON (the deploy script does this automatically)
- Check reserve balance monthly or after every 50 rounds, whichever comes first
- If Pyth raises fees materially, recalibrate the reserve

---

## Provider failover — Pyth → Supra

### Criteria for initiating failover

Provider failover requires a new contract deployment (V3 has no proxy; the entropy address is set at construction). Failover is therefore a heavyweight operation — not triggered lightly.

Initiate failover when **all of the following** are true:
1. At least 3 consecutive rounds have hit `VRF_CALLBACK_TIMEOUT` on the same pool
2. Pyth's status page or team confirms the Monad deployment has no recovery ETA
3. The prize pool has depositors who need a functioning round within the next week

Do **not** initiate failover for:
- A single timeout (transient network issue)
- A Pyth outage with a stated fix ETA within 48 hours
- An outage that doesn't overlap with an upcoming draw window

### Failover procedure

1. Deploy a new V3 contract using `DeployTicketPrizePoolShmonV3.s.sol` with Supra dVRF Router set as the entropy parameter
   - **Note:** Supra has a different interface than Pyth. This requires a V3.1 contract variant that implements Supra's `ISupraSValueFeed` / callback pattern. That variant does not exist yet — it must be written before failover can be executed.
2. Pause the affected Pyth pool (`pause()`)
3. Let existing depositors recover their shMON shares from the paused pool via `withdrawPrincipal`
4. Point keeper and frontend at the new Supra pool address

### Supra interface pre-work

ADR-0014 selected Pyth and deferred Supra integration. Before a real failover is possible, a `TicketPrizePoolShmonV3Supra.sol` variant (or a refactored V3 with a swappable VRF adapter) must be written and audited. This is a **prerequisite** for using Supra as failover — it cannot be done under incident pressure.

**Action item:** Write and audit the Supra adapter as a non-urgent background task, before the Pyth pool handles significant TVL, so the failover option is actually available if needed.

---

## VRF reserve low-balance monitoring (ops gap)

The event monitor does not yet proactively alert on low VRF reserve. Until it does, the operational procedure is:

- After every round settles, have the keeper log `address(pool).balance`
- Alert if balance drops below 0.01 MON (approximately 100× minimum fee)

This is a known gap. A future keeper PR should add:
```js
const reserve = await provider.getBalance(poolAddress)
if (reserve < ethers.parseEther('0.01')) {
  await sendAlert(`⚠️ LOW VRF RESERVE: ${poolAddress} balance ${ethers.formatEther(reserve)} MON`)
}
```

---

## Summary — decision table

| Scenario | Timeout before action | Action | Effect |
|---|---|---|---|
| Pyth callback missing, transient | < 1 hour | Wait, check Pyth status | — |
| Pyth callback missing, confirmed | 1 hour (VRF_CALLBACK_TIMEOUT) | `emergencyForceSettle(rid)` | No winner, full shMON share refund via `withdrawPrincipal` |
| VRF reserve depleted | Immediate | `depositVRFReserve()` | Replenish, then retry `commitDraw` |
| Pyth outage ≥ 3 rounds, no ETA | — | Deploy Supra variant (if ready) | New pool, migrate depositors |

---

## Related ADRs

- [ADR-0012 — Reentrancy trust model](0012-reentrancy-trust-model.md) — shMON trust assumption
- [ADR-0013 — Randomness security model](0013-randomness-security-model.md) — superseded for new pools
- [ADR-0014 — VRF as launch requirement; Pyth Entropy as provider](0014-vrf-launch-requirement-pyth-entropy.md) — provider selection rationale and no-unstake design
