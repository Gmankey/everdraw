# Approved deposit story — frontend integration

Date: 2026-10-03
Branch: codex/everdraw-deposit-story
Base: origin/staging 2979c29775044fea40b805d4b9764c9fd680b839 (fetched before integration)

## Approval status
The user approved the standalone visual baseline, including the stronger DEMO MODE
pulse and 75% advance gate, then authorized frontend integration.
Integrated visual approval and production deployment approval are still pending.
No push, merge, Vercel deployment, release configuration change, or transaction was performed.

## Implementation
- V5 Vault page entry inside the vault card: How does this work? (borderless).
- In-place page overlay makes underlying transaction controls inert without unmounting the form.
- Original cards, pill, input line and ticket section retain their exact DOM bounds.
- Animation anchors are measured from the actual input, counter and vault SVG; no separate page layout.
- Opening centers the original cards and locks scrolling; closing restores the previous scroll position. On narrow screens the viewport follows the active card without resizing it.
- Shadow root isolates all demo styles and SVG identifiers from the live app.
- Lazy loading keeps the simulation out of the initial app chunk (about 10.8KB gzip).
- No wallet, real amount, balance, provider, or transaction callback is passed to the demo.
- Trigger is disabled while a transaction is busy or the withdrawal confirmation is open.
- Done, Exit and Escape close the demo and restore trigger focus and body scrolling.
- Loading and failure states remain dismissible.
- Live amount, selected token and action mode remain unchanged.
- App.jsx mounts the entry inside the V5 vault card. V5 headline size and vertical spacing are modestly reduced.
- Unrelated worktree changes in deployment/keeper scripts were preserved.

## Verification
- 63 frontend and story/motion tests passed.
- ESLint on new integration and demo components passed.
- Full npm build with release validation passed in testnet/UAT mode.
- Browser acceptance passed using mocked external services (no real-chain transaction):
  all eight stages, native modal/focus containment, amount and token preservation,
  withdrawal mode preservation, no additional wallet requests, CSS isolation,
  Done/Exit/Escape, scroll restoration, mobile horizontal overflow.
- Desktop and mobile viewport screenshots inspected.
- Existing dependency annotation and large-bundle warnings remain; not introduced by demo logic.
- This verifies UI integration, not live deployment health or contract operations.

## Review
Integrated real frontend: http://localhost:4180/
Approved standalone: http://localhost:4179/prototypes/deposit-story.html

The integrated local server uses VITE_V5_UAT=true and VITE_CHAIN_ID=10143.
Testnet/unavailable-data labels are preview configuration, not a production status report.
Review the entry button, the in-place animation at unchanged card dimensions, and return to the form.
Do not connect a production wallet for visual review.

## October 4 focused-demo revision

Superseded by the follow-up correction below where behavior differs.

- Entry moved below Connect Wallet and renamed How does this work?.
- Opening centers the cards, hides unrelated UI and locks scrolling. Exit restores the prior position.
- Captions occupy measured clear space; ticket flights approach through a separate lower corridor. The deposit pointer renders above the vault and tracks the green token rim.
- Every Next/withdraw/Done action is immediately available, including rapid progression.
- DEPOSIT POOL appears from the start; PRIZE POOL appears from the yield stage.
- The green winner gets timed confetti and a colorful pulsing CONGRATS!; reduced motion uses a static celebration.
- Normal V5 headline/spacing is tighter. Narrow-screen header wrapping prevents the underlying cards overflowing; demo uses the same card sizes as normal mode.
- Focused browser checks passed for caption/actor clearance at sampled animation times, pointer contact, gradual reset, pool-label timing, celebration, scroll lock, immediate progression and state preservation.
- Reduced-motion integration checks passed, including seven mobile stages with the caption above the active card. Screenshots inspected for desktop ticket collection, celebration, initial focus and mobile layout.
- No production deployment, merge or push. Visual approval for this revision remains the user's decision.

## October 4 follow-up: seamless transition and persistent cards

- Removed the short-viewport heuristic that misclassified desktop as mobile. Stacked layout is detected from actual card positions.
- Removed all stage-dependent hiding of the deposit card and ticket readout. Both cards retain their real dimensions and remain rendered throughout.
- Moved How does this work? inside the vault card with a borderless, subdued style.
- Entry scroll interpolates over 700ms; theme and real/demo text crossfade over 450ms. Stage captions crossfade while their anchors move through clear space near the relevant action.
- Desktop framing verified at 1280x720 and 1440x800, including full ticket area and card bottoms. Eight stages retain both cards, with at least five distinct caption anchors outside vault artwork and above the ticket heading.
- Transition test records per-frame scroll and opacity values to verify actual intermediate states, not merely final positions. Entry/exit fades and scroll restoration passed.
- Reduced-motion integration, form/asset/action preservation, wallet isolation, all exit routes and mobile checks passed. Motion tests and lint passed; UAT build passed with existing dependency/chunk warnings.
- Local preview remains http://localhost:4180/. No production deployment. User visual review required.
