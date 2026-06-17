# ADR-0038 — V5 display denomination: plain MON, no ticket abstraction, no shMON disclaimers

**Status:** Accepted
**Date:** 2026-06-16
**Deciders:** Operator (PM)
**Relates to:** ADR-0036 (V5 TWAB architecture — retired tickets), ADR-0035 (shMON direct deposit), ADR-0002 (V4 "1 ticket = 1 MON" framing this supersedes for V5)

## Context

V4 hid all share-accounting churn behind a **ticket** abstraction: 1 ticket = 1 MON. Users saw a stable, whole number of tickets and never saw raw shMON share counts.

V5 (ADR-0036) **retired tickets/rounds** (ADR-0024/0025 retired) in favor of continuous TWAB accounting. That left the *replacement user-facing display unit* unpinned — a gap this ADR closes.

The forcing issue: shMON appreciates against MON over time (its appreciation **is** the prize yield). An shMON depositor who deposits 100 shMON and later withdraws their full principal receives **fewer shMON tokens** than they deposited (e.g. ~95.2 shMON when the rate has moved 1.00→1.05), even though the **MON value is unchanged** (95.2 × 1.05 = 100 MON). The ~4.8 shMON delta is the depositor's forgone yield, which funded prizes — identical economics to a MON depositor, who simply never sees a changing unit. This is an **optics** problem, not an economic one.

## Decision

1. **Denominate everything the user sees in MON.** "Your balance: 100 MON." No tickets, no branded "credits"/position unit, no raw shMON share counts in the product surface.
   - This is honest and contract-true: PrizeVaultV5 already stores principal in MON (`principalOf` / `totalPrincipal` are asset-denominated), and win-odds are time-weighted **MON** balance — not share count. The stable number already exists on-chain; we display it directly. **No contract change is required.**
2. **No proactive shMON disclaimers in the product.** We do **not** add deposit-time or withdrawal-time copy pre-empting the "my shMON token count went down" reaction. **Operator decision:** handle it reactively via **customer support** if questions arise, rather than front-loading every shMON depositor with an explanation most won't need.
   - The one place the raw shrinking number is unavoidable — the wallet's own transaction view at withdrawal ("received 95.2 shMON") — is outside our UI and is accepted as a support-handled edge, not a UX surface we caption.

## Rationale

- Plain MON is the truest successor to "1 ticket = 1 MON": tickets were always a skin over MON-principal, and that principal still exists in V5. Reintroducing a branded unit would re-add a concept ADR-0036 deliberately removed.
- Disclaimers add friction at the most sensitive moments (deposit/withdraw) for a reaction that only a subset of shMON depositors will have. Operator's call: keep the surface clean; absorb the rare question in support.

## Consequences

- **Frontend:** balances, deposit/withdraw amounts, and prize figures render in MON. Never surface shMON share counts. (Shortfall mode — ADR-0036 §7.1 — is the only state where displayed withdrawable value is intentionally below deposited principal; that haircut display is governed there, not here.)
- **Docs (`docs/how-it-works/`):** frame the user model in MON; no dedicated "why did my shMON go down" explainer is required by this ADR (support owns that). If support volume later justifies a help-center article, add one then — it does not change this decision.
- **Customer support:** owns the "fewer shMON tokens, same MON value" explanation. A short internal support note (canned answer + the worked example above) should exist before mainnet so support can answer consistently. Track as an M9 launch-readiness item, not a build item.
- **No contract change.**

## For the record — future sessions
Do **not** "helpfully" re-add shMON disclaimers to deposit/withdraw flows. Their absence is a deliberate operator decision (2026-06-16), not an oversight.

## Related ADRs
- ADR-0036 (retired tickets; principal-in-MON accounting; §7.1 shortfall display)
- ADR-0035 (shMON direct deposit — the symmetry that makes MON the correct shared unit)
- ADR-0002 (the V4 ticket=MON framing superseded here for V5)
