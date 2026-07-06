# Builder ticket — Land the V5 frontend on staging + reconcile the #190 points redesign (do SECOND)

**Implements:** merged `tasks/v5-points-redesign-builder-ticket.md` §5, plus operator additions 2026-07-06.
**Priority:** 2 of 3 (after `v5-points-checkpoint-and-history-fix-builder-ticket.md`, before ADR-0043).

## Background — read this before touching anything
The working V5 frontend (`V5UatExperience`, gated by `VITE_V5_UAT=true` in `web/src/main.jsx`) lives on branch **`feat/v5-degen-flow`** (183b7f3) and was **never merged to staging**. PR #190 (points-page redesign) was built off staging's V4-only App.jsx and, when deployed to UAT, replaced the working V5 site — that regression has been rolled back (UAT currently runs raw `feat/v5-degen-flow`). A naive `git merge` of the two was attempted and produced a **broken hybrid**: it kept #190's V4 render path and tree-shook the entire V5 vault experience out of the bundle. Do NOT repeat the git-merge approach for App.jsx.

## Step 1 — End the divergence: land `feat/v5-degen-flow` on staging
Merge/rebase `feat/v5-degen-flow` into staging. This is safe for production builds because `VITE_V5_UAT` defaults to false (production everdraw.xyz keeps rendering the V4 `App`). Resolve the App.jsx collision **by hand, taking the degen-flow V5 experience as the base** and re-applying #190's points-page changes into it (Step 2) — not the other way around.

## Step 2 — Re-apply the #190 points redesign INSIDE the V5 experience
Port the #190 elements into the points page as rendered by `V5UatExperience` (all specs in the merged points ticket §5): "Recent draws" / "Your entry" naming, entries-based rows, bonuses pills, Degen source row, effective (points-weighted) multiplier, tier badge separate, "next multiplier" element, context-aware withdrawal confirm modal (full = reset warning, partial = LIFO warning). The indexer backend for all of this is already live (`everdraw-indexer-uat.fly.dev`, per-tranche entries derivation merged in #191).

## Step 3 — Operator additions (2026-07-06)
1. **Two labeled multipliers on the profile/points header** — replace the single "Active multiplier" pill with:
   - **"Main vault multiplier"** — the vault streak curve (1.00→2.00×), with its next-multiplier progress.
   - **"Patron vault multiplier"** — the degen ramp (2→5×), shown whenever the wallet has (or had) a Patron position, with its own ramp progress ("N more draws to 4×"). Wallet `0x4733…a90a` holds ~48.9 MON Patron principal and currently sees only "Active multiplier 1.00×" — that hides half its actual points math.
2. **Streak-dot hover tooltip** — hovering any weekly-streak milestone dot shows "Next multiplier: N.NN×" (the multiplier the user reaches at that dot's week). Static per-dot values from the §2 curve.
3. **Patron page milestone bar** — on the Patron/Degen section, a streak/ramp progress bar mirroring the vault one: current degen streak, next ramp step, and the 5× cap.

## Step 4 — Deploy + verify live (CLAUDE.md rule 6)
Deploy to Vercel project `everdraw-v5-uat` (env vars incl. `VITE_V5_UAT=true`, `VITE_INDEXER_URL=https://everdraw-indexer-uat.fly.dev` already set). Verify ON THE LIVE SITE with `0x4733…a90a`: V5 vault loads (no `require(false)`), points page shows both multipliers + redesign elements, history tab populated, withdrawal modal shows the right warning for partial vs full. Screenshot each for PM review.

## External dependencies (rule 5)
- UAT indexer API (live, fixed in #191 + ticket 1 of 3) — the page is display-only over it.
- Vercel `everdraw-v5-uat` — build-time env baking (Vite): any env change requires redeploy.
- No contract, keeper, or indexer-schema changes in this ticket.
