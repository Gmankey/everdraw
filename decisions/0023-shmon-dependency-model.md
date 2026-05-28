# ADR-0023: shMON Dependency Model and Graceful-Degradation Roadmap

**Status:** Accepted
**Date:** 2026-05-28
**Deciders:** Owner
**Triggered by:** Post-V3-audit external-dependency review (2026-05-28). The contract audit was clean for contract logic but the operator surfaced that the shMON dependency has no graceful-degradation story. This ADR documents the trust model and the planned mitigations.

---

## Context

The V3 contract (`TicketPrizePoolShmonV3`) takes user deposits in MON and immediately converts them to shMON shares via `shmon.deposit{value: cost}(cost, address(this))`. From that point, the protocol's entire user-facing balance is held as shMON shares. User principal returns and prize claims are all `shmon.transfer` calls.

The contract has **no fallback** for any shMON failure mode:

- `shmon` is `immutable` (line 236 of `TicketPrizePoolShmonV3.sol`). Cannot be swapped post-deploy.
- `shmon.deposit`, `shmon.previewDeposit`, `shmon.transfer` are called unconditionally with no try/catch.
- If `shmon.transfer` reverts during `_finalizeDraw`'s fee transfer, the round freezes in `Drawn` state. `claimPrize` and `withdrawPrincipal` (which also call `shmon.transfer`) would also revert. **User funds are locked until shMON recovers.**

The current internal V3 audit (2026-05-28) explicitly flagged this as a real risk but rated it below the reporting threshold because shMON's actual implementation has no blacklist, no pause, no fee-on-transfer. The risk is "shMON adds these features in the future" or "shMON has a critical bug."

---

## Decision

Document the shMON dependency model explicitly, set policy to mitigate the worst-case failure modes operationally until graceful-degradation can be added to a future contract version, and accept the residual catastrophic risk.

### Trust assumptions on shMON (current V3 contract)

| Assumption | Why we make it | What breaks if false |
|------------|----------------|----------------------|
| `shmon.deposit` succeeds and returns nonzero shares for any nonzero MON input | shMON is a standard ERC-4626 vault with no deposit cap | `buyTickets` reverts; users can't deposit. No fund loss. |
| `shmon.previewDeposit(M)` returns a deterministic, MEV-resistant share count for any M | ERC-4626 spec | Wrong prize computation; could allow value extraction |
| `shmon.transfer(to, amount)` returns true and credits balance for any non-zero `to`, given sufficient sender balance | shMON has no blacklist, no pause, no fee-on-transfer | `_finalizeDraw` fee path, `claimPrize`, `withdrawPrincipal` all revert → user funds locked until shMON recovers |
| shMON is not hacked / drained | Audit + reputation of shMonad team | All user principal lost; no contract recovery |

### Operational mitigations active now

1. **Fee is set to 0 bps.** With `feeBps = 0`, no `shmon.transfer` happens in `_finalizeDraw`. Only `claimPrize` and `withdrawPrincipal` exercise the `shmon.transfer` path, and those are user-initiated retries (a user hitting a reverted transfer can simply retry when shMON recovers). **This eliminates the round-freeze risk** for as long as fee remains at 0.

2. **Fee will not be raised** until a future contract version (V3.1 or V4) includes graceful-degradation on the fee transfer path.

3. **shMON health monitoring.** The ops team (currently: just the owner) tracks the shMON contract for: paused state, ownership changes, governance proposals that affect transfer behavior, exchange-rate anomalies (deposits returning unexpectedly few or many shares).

### Failure-mode coverage table

| Failure mode | Severity | Current coverage | Planned mitigation |
|--------------|----------|------------------|-------------------|
| shMON adds blacklist / transfer pause | Round funds locked while paused | Mitigated by fee=0 policy (no round-freeze surface); claimPrize/withdrawPrincipal user can retry | V3.1: try/catch on shmon.transfer; fall back to "claim later" pending balance accounting |
| shMON share rate drops (slashing) | Per-share MON value falls; total contract value falls; depositors take pro-rata loss | Inherent to the share-based model (ADR-0004). Users bear underlying staking risk. | Document explicitly to users; no contract-level mitigation possible |
| shMON contract is hacked / drained | Total catastrophic loss | None | None possible; principal is in shMON |
| shMonad team deploys a new shMON contract and deprecates the current one | New deposits should go to V3.1 with new address; existing rounds keep using old shMON | None — `shmon` is immutable | V3.1: deploy with new address; old rounds finalize on old shMON until users withdraw |
| shMonad team adds fee-on-transfer | Each `shmon.transfer` debits more than expected; accounting drifts | None | V3.1: read returned balance change rather than assuming full amount, OR refuse to deploy against any shMON variant that has fee-on-transfer |
| shMON deposit returns zero shares for nonzero MON | `_buyTicketsMON` reverts with `ZeroSharesMinted` (line 510) | Mitigated — user is refunded by revert, no fund loss | None needed |

---

## Implementation roadmap (Phase 2 contract — V3.1 or V4)

These are the contract changes the next version must include. They are **not** required for the planned Sun 2026-05-31 Vault B V3 deployment (which uses the current V3 source), but they are required before raising the fee or growing TVL meaningfully.

### Mandatory

1. **Try/catch on the fee transfer in `_finalizeDraw`.** If `shmon.transfer(feeRecipient, feeShares)` reverts, skip the fee step, emit a `ProtocolFeeSkipped(rid, feeShares, reason)` event, and continue settlement. The fee shares stay in the contract; owner can sweep them with a separate `sweepUnsentFees(rid)` call once shMON is healthy again.

2. **Try/catch on `claimPrize` and `withdrawPrincipal` transfer paths.** If the transfer fails, do NOT zero the user's claim state. The user retries when shMON recovers. Emit a `TransferDeferred(rid, user, amount, reason)` event for off-chain observability.

3. **Sanity-check returned share counts on `shmon.deposit`.** Already partially present (`if (shares == 0) revert ZeroSharesMinted()`). Extend to reject deposits where `shares < expectedMin` to catch fee-on-transfer variants.

### Recommended

4. **Two-phase deposit path.** Optionally allow users to "withdraw available pending balance" if a previous claim transfer was deferred. Avoids users having to re-call the original function.

5. **Per-block share-rate sanity check.** Before computing `principalSharesAtSettle = previewDeposit(totalPrincipalMON)`, verify the rate is within a sane bound (e.g., ±50% from the rate observed at the most recent deposit). If outside bounds, refuse to settle and emit `RateSanityFailed(rid, currentRate, lastDepositRate)`. Owner can then `emergencyForceSettle` and investigate. Prevents an attacker who briefly manipulates shMON's reported rate from extracting value.

### Out of scope (do not include)

- Making `shmon` mutable post-deploy. Adds owner surface area without meaningful upside; redeploying is cheaper than the security tradeoff.
- Holding native MON in reserve to "redeem ourselves" if shMON breaks. The premise of a no-loss vault is principal-in-yield-asset. Holding MON separately defeats the purpose.

---

## Recovery procedures

### shMON pauses transfers

Symptoms: `claimPrize` and `withdrawPrincipal` revert for users. `_finalizeDraw` is currently safe because `feeBps = 0`.

Response:
1. Public communication: Telegram, Twitter, Discord — explain to users that transfers will resume when shMON recovers, no funds at risk.
2. Pause our contracts (`pause()`) to prevent new deposits going into a stuck system.
3. Monitor shMonad team's recovery announcement.
4. When shMON resumes, `unpause()` and let user retries flow naturally.

### shMON shares lose value (slashing or pool loss)

Symptoms: `previewDeposit(M)` returns more shares than were minted for M MON at deposit time, meaning per-share MON value is now lower.

Response:
1. Public communication: explain the underlying staking loss is shared pro-rata.
2. Rounds with active deposits at the moment of the loss will settle with `grossPrizeShares = 0` (since `previewDeposit(totalPrincipalMON) > totalPrincipalShmonShares`). Users get their full deposited share count back, but those shares are worth less MON than they paid.
3. No contract change required; this is by design.

### shMON is hacked / drained

Symptoms: shMON shares unredeemable, contract `shmon.balanceOf(this)` may go to zero, all user funds gone.

Response:
1. Pause our contracts immediately.
2. Public communication.
3. Coordinate with shMonad team on any partial recovery / treasury reimbursement.
4. There is no protocol-level recovery. This is the documented catastrophic case in ADR-0022.

### shMonad ships new shMON contract, deprecates ours

Symptoms: shMON team announces new contract address; expected migration window.

Response:
1. During the migration window, set our contracts to pause-then-final-settlement mode: pause new deposits, allow existing rounds to finalize on the current shMON, allow users to claim/withdraw.
2. Deploy V3.1 against the new shMON address.
3. New rounds open on V3.1. V3.0 stays live for in-flight finalization; eventually retired when all users have withdrawn.

---

## Consequences

- The fee=0 policy is now documented commitment, not just a current state. Future fee enabling requires either (a) V3.1 contract with graceful-degradation, or (b) explicit ADR amendment.
- Phase 2 contract work (V3.1 or V4) gains a concrete mandatory feature list.
- Operators and auditors now have a single artifact that names every shMON failure mode and our response.
- This ADR is the template for documenting other external dependencies (Pyth, Monad L1, infra). Following ADRs may be:
  - ADR-0024: Pyth dependency model
  - ADR-0025: Monad L1 dependency model
  - ADR-0026: Infrastructure dependency model (Fly, Vercel, DNS)

---

## Rejected alternatives

**"Add try/catch to V3 directly via a new contract that wraps shmon.transfer."** Rejected. Would require either redeploying V3 (losing in-flight state) or adding a separate router contract that introduces its own attack surface. Cleanest path is the V3.1 redeploy when other Phase 2 items are ready.

**"Keep fee=0 forever; we never need protocol revenue."** Rejected as a long-term policy. Protocol sustainability eventually requires either fee revenue or token economics. Phase 2 contract should support fees safely.

**"Trust shMON entirely; don't document this as a risk."** Rejected. shMON is a young protocol on a young L1. Operational discipline requires explicit acknowledgement of every dependency. Future operators (or a future Claude session) must be able to read this ADR and understand the trust surface in 5 minutes.
