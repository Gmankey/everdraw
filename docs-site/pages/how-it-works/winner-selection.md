# Winner Selection

EverDraw uses verifiable randomness for each weekly draw. V5 winner selection is based on time-weighted entries for that draw period: the longer your balance is held during the period, the more entries it earns.

---

## How the draw works

**1. Snapshot the draw period.** At the end of the weekly draw period, the protocol measures each eligible account's time-weighted balance. This becomes the entry set for that draw.

**2. Escrow the prize.** Available vault yield is moved into the prize path. Principal stays separate from prize yield.

**3. Request randomness.** The draw manager requests randomness from Pyth Entropy. The provider's value is committed before the result is known, and the contract verifies the callback.

**4. Finalize winners.** The finalized random value selects winner(s) from the entry set. Anyone can verify the calculation from public draw data.

---

## Entries, not fixed tickets

V5 does not use a fixed ticket purchase deadline. Entries are derived from balance-minutes:

```
entries = 0.005 x balance in MON x minutes held
```

A deposit held for a full weekly draw period earns the full period's entries. A deposit made halfway through the period earns roughly half for that draw. A withdrawal keeps entries already earned up to the withdrawal time, then stops earning future entries on the withdrawn amount.

---

## Patron pool is excluded

Patron pool deposits do not enter winner selection. They add yield to the prize and earn boosted EverDraw points, but they have zero draw entries.

---

## Why this design

**Linear and proportional.** Your chance comes from your entries divided by total eligible entries for that draw. No points tier, Patron boost, or hidden status changes win odds.

**Manipulation resistant.** Randomness comes from an external committed source and is verified on-chain. Changes to critical draw infrastructure are designed to be visible and delayed rather than instant.

**Transparent and reproducible.** Draw inputs, roots, and lifecycle events are public. The indexer and app present the result, but the source of truth is on-chain.

**Robust to outages.** If a keeper or randomness provider is delayed, the draw can recover through the configured lifecycle. Principal is not used to pay prizes and remains accounted for separately.
