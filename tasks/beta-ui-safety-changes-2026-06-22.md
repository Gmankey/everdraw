# Beta UI safety changes — record (2026-06-22)

**Owner:** builder (frontend). PM record so this isn't lost; pickable up later.
**Scope (intentional):** frontend safety/disclosure only — open EverDraw to early users *before* the formal third-party audit. No contract changes, no broader redesign.

## What was built

1. **Beta indicator** — small low-noise "Beta" pill top-right near wallet/connect (not a banner). Tooltip: *"beta phase. Please size deposits accordingly."*
2. **Footer audit/risk disclaimer** — states EverDraw is in beta awaiting a formal third-party audit; longer approved risk copy (protocol, yield integrations, indexer data, wallet connections, third-party protocols, wallet security, legal/tax, liability limits). Removed the duplicate beta text that had appeared at the top of the UI.
3. **Per-wallet UI ticket cap — 25,000 tickets/wallet.** Frontend guardrail ONLY; does not change contract behavior; bypassable by direct contract interaction (out of UI scope). Error copy: *"limit reached. remaining tickets you can purchase is xxxx"*.
4. **Analytics/reporting check** — reviewed whether frontend/indexer can report beta metrics (user count, locked TVL, usage/activity). PostHog considered if existing analytics is insufficient for product/funnel reporting.

## Explicitly NOT changed
My Rounds, winner/result views, vault animations, points/rewards UI, contracts. No broader redesign.

## ⚠️ Don't conflate these two caps
- **UI ticket cap (this doc):** 25,000 tickets/wallet, frontend-only, cosmetic guardrail, bypassable.
- **Contract deposit cap (M7 / ADR-0036 Q6 / B1):** a launch-gating on-chain total-deposit cap, the "amount we can afford to lose unaudited," operator-set, NOT bypassable.
These are independent. The UI cap is not a substitute for the contract cap; V5.0 still must ship the contract cap per B1.

## Follow-ups
- **Live-surface verification (working rule #6):** confirm on production (everdraw.xyz) that the Beta pill + tooltip render, footer shows the approved long disclaimer (no duplicate top text), and the 25k cap actually blocks with the correct remaining-count message. Not "done" until verified live, not just merged.
- **Open PM question:** add PostHog, or is existing indexer/analytics enough for the first beta cohort? (PM recommendation below.)

## PM recommendation on PostHog
For the **first beta cohort**, the three stated metrics — user count, locked TVL, usage/activity — are all derivable on-chain from the indexer's `Deposit`/`Withdraw` event stream (authoritative, no extra tooling). **PostHog only earns its place if you want *funnel/product* analytics** the chain can't give: connect→deposit conversion, drop-off, page/UX behavior. Recommendation: **ship beta on indexer reporting; defer PostHog** unless/until funnel insight is explicitly wanted. Revisit when scaling the cohort. (Operator/product call — flagged, not actioned.)
