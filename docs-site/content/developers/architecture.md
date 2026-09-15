# V5 Architecture

EverDraw V5 is a continuous prize-savings system built from six deployment-bound contracts plus managed off-chain services.

## Contracts

| Component | Responsibility |
|---|---|
| PrizeVaultV5 | Participant and Patron principal, shMON strategy accounting, withdrawals, prize-yield escrow |
| ShmonStrategy | Converts MON deposits to shMON shares and transfers shares for withdrawals and prizes |
| EverdrawTwabController | Records balances over time for each draw period |
| DrawManagerV5 | Draw schedule, randomness requests, prize snapshot, root proposal, veto, and finalization |
| PythRandomnessOracle | DrawManager-bound adapter for Pyth Entropy |
| ClaimManagerV5 | Escrowed Merkle distributions, replay protection, prize compounding, and deferred payout handling |

A deployment tuple is identified by its vault, DrawManager, and ClaimManager. Indexer state and frontend configuration must never mix addresses from different tuples.

## Draw lifecycle

1. Deposits and withdrawals continuously update principal and TWAB.
2. After the period ends, the keeper calls startDraw.
3. The vault escrows a fixed shMON share prize into ClaimManager.
4. Pyth Entropy returns a seed.
5. The keeper computes and proposes the deterministic winner root.
6. The independent watcher recomputes the root during the challenge window.
7. The root finalizes if it is not vetoed.
8. The keeper submits valid winner proofs to ClaimManager.
9. Winner shares normally compound into fresh tenure-zero vault tranches.

A draw with no eligible TWAB or no prize can be skipped without manufacturing a payout.

## Off-chain services

- **Keeper:** managed, restartable lifecycle automation with balance and dead-man alerting.
- **Root watcher:** independent recomputation and mismatch alerting; it does not share the keeper's trust role.
- **Indexer:** finalized event ingestion, reorg-safe deployment isolation, tranche reconstruction, points, history, and health APIs.
- **Frontend:** release-manifest-bound reads and writes with runtime wiring checks before transactions.

See ADR-0036, ADR-0045, ADR-0048, ADR-0049, and ADR-0050 for the current decisions.
