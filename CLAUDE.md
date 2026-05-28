# EverDraw — Required Reading for Every Session

**Before doing any work on this repo, read `decisions/`.**

That folder contains Architecture Decision Records (ADRs). Every non-trivial design decision is recorded there with context, rationale, and rejected alternatives. If you cannot find an ADR for a decision you are about to make or revisit, **stop and ask** — do not rely on memory, chat history, or summaries. Sessions reset; the ADRs do not.

## Working rules

1. **Never make or revisit a design decision without checking `decisions/`.** If a decision is missing, write the ADR before implementing.
2. **Never edit `src/` directly.** Code changes go through the builder agent. (See `memory/feedback_use_builder_for_code.md` if available.)
3. **Builder tickets must cite the ADR number** they implement or modify. If a ticket changes a decision, the ADR must be updated in the same change.
4. **User-facing docs (`docs/how-it-works/`, `docs/getting-started/`, etc.) describe the product to users.** ADRs describe the engineering decisions to ourselves. Do not conflate them.
5. **External dependencies are part of every design.** Every ADR, builder ticket, and audit must explicitly enumerate the external contracts/services the change relies on and document what happens when each one fails. See `memory/working_rule_external_dependencies.md` for the full checklist. Contract correctness in isolation is not sufficient; a clean audit that doesn't name its dependency assumptions is incomplete.

## Where things live

- `decisions/` — ADRs (engineering decisions, source of truth for spec)
- `docs/how-it-works/`, `docs/getting-started/`, `docs/vision/` — user-facing
- `src/` — Solidity contracts (builder-only edits)
- `web/` — React frontend (builder-only edits for app code)
- `scripts/` — keeper, indexer, ops tooling
- `abi/` — verified contract ABIs

## When the user describes a design intent

If the user says "we discussed X" and X is not in an ADR, the correct response is:
1. Acknowledge there is no ADR yet.
2. Capture the intent into a draft ADR in the same response.
3. Confirm the spec back to the user before any code work begins.

Do not pretend to remember. Do not fabricate. Write it down.
