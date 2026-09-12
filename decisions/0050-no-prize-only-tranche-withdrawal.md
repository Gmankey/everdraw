# ADR-0050 - No prize-only withdrawal of compounded tranches

**Status:** Accepted
**Date:** 2026-09-12
**Decider:** Operator
**Clarifies:** ADR-0043, ADR-0045, ADR-0048

## Decision

Remove the earlier frontend/soak requirement to withdraw a specific already-compounded prize
tranche. Compounded winnings are part of the ordinary participant position and leave through the
normal amount-based vault withdrawal flow. No prize-only withdrawal action or candidate amount is
exposed. WINNER history remains visible. Recovery of genuinely unclaimed finalized winner leaves
through the verified, batched claim-proof flow is unchanged; that is a claim, not a withdrawal of
an already-compounded tranche.

## Rationale and consequences

The vault withdrawal API accepts an amount, not a tranche ID. The offchain ledger applies LIFO;
withdrawing an arbitrary older prize tranche while guaranteeing all other tranches are untouched
is not supported. No contract change or redeploy is authorized by this decision. The active soak
checklist and frontend history model must not imply that capability. Historical audit evidence is
not rewritten.

## Dependencies

shMON share payouts, RPC verification, and the indexer's verified claim-proof storage keep their
existing ADR-0045/0048 failure behavior. A missing or unverified unclaimed proof must not be treated
as authorization to withdraw principal. Ordinary withdrawals remain independent of claim recovery.
