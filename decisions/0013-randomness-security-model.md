# ADR-0013 — Randomness security model and prize-cap threshold

**Status:** Accepted
**Date:** 2026-05-20
**Deciders:** User + Claude

## Context

`_drawWinner` selects a winner using:

```solidity
bytes32 rnd = keccak256(abi.encodePacked(
    blockhash(r.targetBlockNumber),
    rid,
    r.totalPrincipalMON,
    r.totalTickets,
    block.prevrandao
));
```

Slither flags this as `weak-prng`. The model is **economically** secure — not cryptographically secure. This ADR makes that explicit and sets the conditions under which it stays acceptable.

## The threat model

**Threat 1 — Target block miner manipulates hash.**
The validator who produces `targetBlockNumber` can try multiple candidate blocks and pick whichever hash benefits them (or a colluding ticket-buyer).

**Mitigation already in place (ADR-0002):** `targetBlockNumber` is set at commit time, ~6 days before the draw. At commit time, nobody knows which validator will produce the target block. This makes pre-selecting a corruptible validator infeasible for any attacker who is not also the validator. ✓

**Threat 2 — Settle-block proposer manipulates `block.prevrandao`.**
`block.prevrandao` in the draw transaction is the prevrandao of the *settle block* — not the target block. The validator currently proposing the settle block can choose to include or delay the tx to influence this value.

**Mitigation:** None currently. This is an accepted risk under the economic-security model below.

**Threat 3 — Blockhash expiry window (255 blocks).**
If the settle tx is delayed beyond 255 blocks past `targetBlockNumber`, `blockhash` returns zero and the draw falls back to `emergencyForceSettle`. A malicious or colluding keeper could:
- Delay the settle tx to force the emergency path, or
- Time the tx to land in a settle block with a favorable prevrandao.

**Mitigation:** Keeper is permissioned (owner-controlled). Emergency path exists as a safety valve, not an upgrade. Monitor keeper latency.

## Security model

**The randomness is economically secure, not cryptographically secure.**

It is sound as long as: `expected_validator_reward_from_manipulation < expected_validator_penalty + cost_of_coordination`.

On Monad, validator slots are pseudorandom and short-duration. Coordinating a specific validator for a specific block is expensive. This model is safe up to a prize threshold above which it becomes profitable to corrupt.

## Prize-cap threshold

We set the following **informal threshold** (not enforced on-chain at this time):

> At weekly prize values **below $50,000 USD equivalent**, the economic-security model is acceptable.
> Above $50,000 per round, we must evaluate upgrading to a verifiable randomness source (Monad VRF, Chainlink VRF, or equivalent).

This threshold is a governance guideline, not a contract invariant. If TVL grows such that weekly yield approaches $50k, the engineering and product teams must initiate a VRF migration before that threshold is crossed.

## Rejected alternatives

- **Chainlink VRF now:** Adds oracle dependency; Chainlink availability on Monad is not confirmed at time of writing.
- **Monad VRF / native randomness:** Not available at time of writing; should be adopted when available.
- **Commit-reveal with user-provided entropy:** Introduces last-revealer attacks (worse than current model for a keeper-driven draw).

## Consequences

- No code change required now.
- Product must monitor weekly prize size against the $50k threshold.
- When Monad VRF becomes available, file a migration ADR and builder ticket before crossing the threshold.
- ADR-0002 ("the lock is not for randomness windowing") remains accurate — this ADR is the companion that makes the randomness threat model explicit.

## Related ADRs

- ADR-0002 — Lock-period semantics and draw timing
