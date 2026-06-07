# Winner Selection

EverDraw uses **Pyth Entropy** for verifiable randomness. Every draw is performed on-chain, derived from a value an external provider commits to in advance, and is independently reproducible by anyone from public data.

---

## How the draw works

**1. Commit.** When a round's deposit window and lock have both ended, the round is committed. The contract builds a user-side seed from on-chain state and requests randomness from the Pyth Entropy contract, paying a small fee from the vault's own randomness reserve. The round moves to an *awaiting randomness* state.

**2. Reveal.** The Pyth provider delivers a callback within seconds to minutes. The delivered random value is the cryptographic combination of two independent inputs:

- The provider's pre-committed, hashed value — committed *before* the request was made, so it cannot be chosen after the fact.
- The user-side seed from the commit step.

Neither party can bias the result on its own. The contract verifies the callback comes from the expected entropy contract and provider, stores the random value, and marks the round *drawn*.

**3. Finalize.** Anyone can finalize a drawn round. The contract derives the winning ticket(s) from the stored random value, records the winners and their prize shares on-chain, and settles the round. Winners can then claim; every depositor can then withdraw principal.

---

## One winner or many

A vault is configured at creation to pay either a single winner or several winning positions that split the prize by a fixed allocation (for example, a larger first prize and smaller runner-up prizes).

When a vault pays multiple positions, the draw selects that many **distinct** winning tickets from the round using repeated sampling of the single random value — no ticket can win two positions. The prize is then divided across the winning positions according to the vault's allocation. If a round has fewer tickets than prize positions, only the available positions are filled and the unallocated share is returned to depositors, preserving the no-loss guarantee.

A ticket maps to whoever bought it, in purchase order. The same buyer can hold many tickets and can win more than one position; all of their winnings are claimable together.

---

## Why this design

**Manipulation resistant.** The randomness combines two independent commitments. The provider commits to its value before seeing the request, and the user-side seed includes block-level entropy that the producer of a block cannot easily steer. Biasing the outcome would require controlling both the provider and the operator — a trust assumption that is further mitigated by a time-delay on changing the entropy provider, so any change is visible and cannot take effect instantly.

**Transparent and verifiable.** The randomness source, the calculation, and the result are all public. Anyone can recompute the winners deterministically from the on-chain random value and the round's ticket count.

**Robust to outages.** If a randomness callback fails to arrive within the timeout, the round can be force-settled with no winner, and all depositors recover their full principal. No round can be permanently locked by a randomness-provider outage.

---

## Probability is linear

Your odds for any prize position are simply your tickets divided by the total tickets in the round. 1 in 100 is 1%. 50 in 100 is 50%. There are no bonus tiers, no boosted odds, and no house edge. A vault may route a small, capped share of the *yield* to the protocol or to partners, but this only affects the size of the prize pool — never who wins, and never anyone's principal.
