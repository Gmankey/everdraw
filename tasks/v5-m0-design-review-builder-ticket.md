# Builder Ticket — V5 M0: Adversarial Design Review of ADR-0036

**Implements:** ADR-0036 (milestone M0 of `tasks/v5-build-plan.md`).
**Assignee:** builder (Mendel).
**Blocks:** all V5 build milestones (M1+). Nothing is coded before this completes.

## Objective

Read ADR-0036 adversarially and either sign off or force amendments. You are the check on the design, not its executor — the prior PM's design record (handoff doc Part 4) shows exactly the failure modes to hunt for: omitted requirements, overstated capabilities, unexamined coupling, "safeguards" that are prose instead of mechanisms.

## Inputs (read in this order)

1. `decisions/0036-v5-twab-architecture.md` — the design under review. Operator decisions D1–D4 (§1) and Q1–Q7 (§10) are **locked**; challenge their *consequences* freely, but changing them needs the operator, not you or the PM.
2. `tasks/v5-build-plan.md` — milestones/gates you'll be held to. Dispute any gate you consider untestable or insufficient NOW.
3. `decisions/0034-v5-yield-and-reward-architecture.md` — requirements R0–R6. Verify ADR-0036 actually satisfies every one (the prior PM has omitted requirements before).
4. `tasks/v5-design-handoff-to-builder.md` Part 4 — the failure record. Treat every area named there as untrusted until you've re-derived it.
5. `docs-site/pages/vision/phase-2.md` — the public promise. Verify the design delivers it or explicitly amends it.

## Required review passes (deliverable: a findings doc per pass, even if "no findings")

1. **Requirements coverage:** R0–R6 + all four sponsor models + the §6 V5.1 seam, traced requirement-by-requirement into a §-numbered design element. Any requirement without a mechanism = finding.
2. **The §6 seam test:** design the V5.1 CampaignManager *on paper, one page* against the frozen V5.0 interfaces. If you can't, V5.0's interfaces are wrong — finding. (This is the cheapest moment to discover it.)
3. **Payout substrate:** check ClaimManager (§3.5) against every disbursement type (winner/fee/reward/deferred) × every failure (reverting token, blacklisting token, rebasing drift, keeper death, pause, stop). The ADR-0028 guarantee — nothing lost, nothing trapped, one failure never blocks others — must hold in every cell.
4. **TWAB + draw pipeline:** §3.1/§3.4/§4 — ring-buffer edge cases, same-block ordering, snapshot-vs-period-end sandwich, root proposal liveness/griefing, veto scope. Confirm or reject the adapt-PoolTogether recommendation (§3.1); rejecting it = ADR amendment with rationale in the same change.
5. **External dependencies (working rule #5):** re-derive §7.2's table yourself; any dependency or failure mode the table misses = finding.
6. **No-loss invariant:** trace every path that touches principal (deposit, withdraw, emergency exit, strategy swap, venue loss, cap) and confirm §7.1's stance holds; confirm deposit cap (§3.2) gates principal exposure and never withdrawals.

## Exit criteria (per build plan M0 gate)

- Findings docs land in `tasks/v5-m0-findings/` via PR.
- Every finding is either fixed as an ADR-0036 amendment (same PR — working rule #3) or explicitly accepted-with-rationale by the PM/operator.
- You state, in writing, either "I sign off on building this" or what blocks sign-off. Do not sign off out of deference; the operator demoted the PM's design judgment for cause, and your dissent is the point of this milestone.

## Out of scope

No code, no `src/` changes, no deploys. V4.1-B deploy and V4.1 frontend cutover are separate tracks already with you — this ticket must not preempt them; the V4.1 work ships first.
