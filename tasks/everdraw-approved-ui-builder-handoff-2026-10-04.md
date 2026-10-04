# EverDraw approved frontend — builder release handoff

## Decision and source

The user visually approved the final integrated design on 2026-10-04 and asked to proceed with builder/release preparation. This document supersedes the iterative October 3 notes and prototype README wherever they describe older design decisions.

- Repository: Gmankey/everdraw.
- Branch: `codex/everdraw-deposit-story`.
- Worktree: `/home/c/.openclaw/workspace/.worktrees/everdraw-deposit-story`.
- Base: `2979c29775044fea40b805d4b9764c9fd680b839`.
- `origin/staging` was fetched during handoff preparation and matched that base, with no divergence before the release commit.
- Integrated review URL: `http://localhost:4180/`.
- The commit containing this handoff is the local release package. Obtain its immutable hash with `git rev-parse codex/everdraw-deposit-story`.
- Nothing has been pushed, merged, or deployed by this handoff. Production state is not certified by these UI tests.

## Approved scope — preserve this design

1. Borderless **How does this work?** control on the same header row as **Next prize draw**, to its right. Not in the global header or at the bottom of the vault.
2. In-place deposit demo using the real card dimensions. Both deposit/withdraw and vault cards remain rendered throughout; no stage-dependent card hiding.
3. Animated scrolling into the focused view, green theme fade, centered pulsing DEMO MODE, and fading/crossfading text. Desktop stacking detection uses actual card positions, not viewport height.
4. Action-specific moving cream speech bubbles, kept clear of the vault, jug, tokens, ticket flights, counter and entry bar. Deposit pointer renders above the artwork and touches the green token's rim.
5. Equal-sized rolling token balls, collision physics, a real hatch gap, animated ticket accrual/reset, yield pouring, orange winner followed by green winner, confetti and CONGRATS!, then withdrawal. All Next actions immediately available.
6. Escape/Exit/Done restore the real form and scroll position. Underlying app is inert during the demo. Demo receives no wallet/provider/transaction callback. Amount, asset selection and action mode are preserved.
7. Slightly smaller V5 headline and tighter spacing. Phone-width header/card overflow fix applies consistently to normal and demo layouts.
8. Top navigation: Vault, Patron, Profile, Leaderboard. Stats stays available at `/#stats`, without a navigation link.
9. Full-width contrasting footer band with separator, Articles/Docs on the left, X icon on the right, disclaimer above it. Same footer on all page routes; no invented social destinations.
10. Patron Pool retains its dropdown, with the exact user-supplied copy and uppercase BOOSTED. No Patron tutorial.

Do not redesign or simplify the approved animation while integrating. Any necessary visual change requires renewed user review.

## Implementation boundaries

- `web/src/components/DepositStoryEntry.jsx`: entry, inert/modal boundary, theme transitions, scroll lifecycle, geometry measurement and shadow-root isolation.
- `web/src/components/AnchoredDepositScene.jsx`: real-layout SVG projection and pointer/ticket paths.
- `web/src/components/depositStoryMotion.js`: independently tested rolling, withdrawal, reset and caption anchors.
- `web/src/prototypes/deposit-story/`: shared scene controller, ball physics, narrative, styling and motion tests. Despite the directory name, these shared modules are runtime dependencies of the integrated demo; do not omit them.
- `web/src/App.jsx` and `App.css`: narrow integration, navigation, footer and Patron copy.
- `web/prototypes/deposit-story.html` and `web/vite.story.config.js`: standalone development reference, not the production entry point.
- `.preview-qa/`: ignored local evidence/browser libraries. No screenshots, downloaded binaries, node_modules, dist, credentials or environment files belong in the release commit.
- No Solidity, keeper, watcher, indexer, deployment manifests, dependency versions or transaction implementation changes.

## Verification and commands

From the worktree's `web` directory:

```sh
node --test src/*.test.js src/components/depositStoryMotion.test.js src/prototypes/deposit-story/story.test.js
./node_modules/.bin/eslint src/components/DepositStoryEntry.jsx src/components/AnchoredDepositScene.jsx src/components/depositStoryMotion.js src/prototypes/deposit-story/*.jsx src/prototypes/deposit-story/story.js
VITE_V5_UAT=true VITE_CHAIN_ID=10143 npm run build
```

Final unit run: **63 passed, 0 failed**. Changed-component lint passed. Release-validated UAT build passed; pre-existing dependency annotation and bundle-size warnings remain.

Final release browser suites: **all four passed** — shell/navigation, integration/state preservation, real-time transitions, and focused animation. The virtual-clock test explicitly waits for native compositor scrolling before checking exit restoration. No production design change was needed for that test-harness correction.

Run the integrated preview on port 4180 with the same UAT variables, then:

```sh
node scripts/test-approved-ui-shell.cjs
node scripts/test-deposit-story-integration.cjs
node scripts/test-deposit-story-transitions.cjs
node scripts/test-deposit-story-focused.cjs
```

These scripts use Playwright Chromium and mock external services. Provide `PLAYWRIGHT_MODULE` / `CHROMIUM_PATH` if not available on normal module/runtime paths. On this workstation, Chromium additionally uses local libraries via `LD_LIBRARY_PATH=../.preview-qa/browser-libs/extracted/usr/lib/x86_64-linux-gnu`; do not hard-code those workstation paths into deployment.

Coverage: six page routes; exact Patron copy; footer desktop/mobile overflow; retained Stats route; eight demo stages; focus containment; amount/asset/mode preservation; no extra wallet requests; caption clearance; true intermediate scroll/opacity frames; unchanged desktop card dimensions; all exit routes; gradual ticket reset; pointer/rim contact; pool label timing; celebration; immediate advancement.

Browser tests prove frontend behavior under mocked services, not mainnet yield assumptions, solvency, withdrawal liquidity or service health. The production release must use its existing production configuration, never the local UAT settings. The Patron withdrawal wording was supplied by the user; this UI release does not independently re-audit that financial claim.

## Builder release steps

1. Review the release commit and refresh `origin/staging`. If staging has advanced, integrate the scoped commit without overwriting newer frontend or operational fixes; rerun the above checks after conflicts.
2. Submit the branch for review targeting **staging**, not another production branch. Preserve existing deployment/build-ignore controls.
3. Build using the canonical production frontend configuration in the intended staging checkout. Validate production manifests and chain settings with the existing build gate. Do not copy `.env`, `dist`, UAT artifacts or the preview server's variables.
4. Merge/deploy only through the authorized production workflow: Vercel project **everdraw**, id `prj_41iuO5toVtvHCvfAGckpR2z9pqUI`, branch **staging**. Do not deploy this local feature branch or historical `everdraw-clean` project.
5. Smoke-test `https://everdraw.xyz`, `/#patron`, `/#stats`, `/#profile`, `/#leaderboard`, `/articles/drawn-back-to-defi` and `/blog/drawn-back-to-defi`. Verify footer destinations, wallet controls, no unexpected layout shifts, demo entry alignment, both cards, all exits and form preservation. No real-value transaction is required for this UI smoke test.
6. Record deployed commit and canonical Vercel deployment URL. If rollback is needed, revert the scoped UI release through staging and redeploy the prior known-good frontend; no contract migration is part of this release.

## PR description

**Title:** feat(web): approved in-place deposit demo and navigation refresh

**Summary:** Add the visually approved, wallet-isolated deposit walkthrough; preserve real card geometry and form state; simplify navigation; add a full-width resources footer; update Patron Pool explanation. UI-only change, no protocol/deployment/dependency modifications.

**Review focus:** shadow-root/inert lifecycle, scroll/focus cleanup, unchanged real transaction inputs, actual card measurements, responsive bubble clearance, retained direct routes, and production configuration separation.
