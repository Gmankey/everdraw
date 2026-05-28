# Winner Selection

EverDraw V3 uses **Pyth Entropy** for verifiable randomness. The full draw is on-chain, signed by an external provider, and independently verifiable.

The V3 architecture replaced an earlier block-hash-based commit-reveal scheme. Block-hash randomness was operationally simple but vulnerable in two ways at meaningful prize sizes: (1) the producer of the target block could in principle bias the outcome by reordering or withholding, and (2) only ~256 blocks of look-back is available, which constrains the timing window. Pyth Entropy resolves both at the cost of a small per-draw fee paid from an owner-funded reserve (~0.77 MON, see [ADR-0014](https://github.com/Gmankey/everdraw/blob/staging/decisions/0014-vrf-launch-requirement-pyth-entropy.md)).

---

## How V3 randomness works

**1. Commit.** When the deposit window plus yield period both close, the keeper calls `commitDraw`. The contract:
- Constructs a user-side entropy seed from on-chain state (round id, ticket count, principal, `block.prevrandao`, `block.timestamp`).
- Calls `entropy.requestWithCallback{value: fee}(provider, userRandom)` on the Pyth Entropy contract. The fee is paid from the contract's own VRF reserve.
- Stores the returned Pyth sequence number and transitions the round to `AwaitingVRF`.

**2. Reveal.** The Pyth provider observes the request off-chain and submits a callback transaction back to the contract within seconds to minutes. The callback delivers a `randomNumber` that is the cryptographic combination of:
- The provider's pre-committed, hashed value (the provider committed to it before the request was made, so cannot choose it after the fact),
- The user-side entropy from step 1.

Neither party can bias the output. The contract validates `msg.sender == entropy` and `provider == entropyProvider`, stores the random number, and transitions to `Drawn`.

**3. Finalize.** Anyone calls `finalizeDraw(rid)`. The contract computes:

```
winningTicket = uint32(uint256(randomNumber) % uint256(totalTickets))
```

Tickets map to buyers in the order purchases were made. The winning ticket, winner address, and the prize shares are recorded on-chain. The round transitions to `Settled`. The winner can now `claimPrize`; every depositor can now `withdrawPrincipal`.

---

## Why this design

**Manipulation resistant.** The randomness combines two independent commitments. The Pyth provider commits to a hash chain before the request, so they cannot pick the value after seeing user state. The user-side seed includes `block.prevrandao` which the producer of the target block cannot easily influence. To bias the outcome, an attacker would need to control both parties — which is the documented trust assumption that breaks if the owner is colluding with the Pyth provider, and is mitigated by the 24-hour timelock on changing the entropy provider (see [ADR-0021](https://github.com/Gmankey/everdraw/blob/staging/decisions/0021-v3-pre-deploy-hardening.md)).

**Transparent and verifiable.** The randomness source, the calculation, and the result are all public. Anyone can verify the winner deterministically from the on-chain `randomNumber` and the recorded `totalTickets`.

**Robust to oracle outage.** If a Pyth callback fails to arrive within `VRF_CALLBACK_TIMEOUT = 1 hour`, the owner can call `emergencyForceSettle(rid)` to mark the round Settled with no winner. All depositors recover their full principal in shMON shares. No round can be permanently locked by a Pyth outage.

---

## Probability is linear

Tickets divided by total tickets. 1 in 100 is 1%. 50 in 100 is 50%. No bonuses, no tiers, no house edge. The protocol fee on yield (currently 0%) does not change odds — it only affects the size of the prize, not who wins.

---

## V2 vault randomness (legacy)

V2 vaults still use the block-hash commit-reveal scheme described above as the prior design. They are being retired in favor of V3 vaults on the same anchor schedule. See [`developers/smart-contract.md`](../developers/smart-contract.md) for the current canonical address list.
