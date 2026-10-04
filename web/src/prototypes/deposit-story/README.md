# EverDraw deposit story

The integrated frontend was visually approved by the user on 2026-10-04.
The authoritative builder handoff is `tasks/everdraw-approved-ui-builder-handoff-2026-10-04.md` at repository root.

## Runtime integration

`DepositStoryEntry` mounts the shared scene in a shadow root and measures the real deposit/vault cards. `AnchoredDepositScene` projects the animation into those bounds. The underlying app is inert while the demo is open; the simulation receives no wallet or transaction callbacks.

This directory contains **runtime dependencies**, not just throwaway prototype code. Keep `DepositStory.jsx`, `VaultMotion.jsx`, `motion.js`, `story.js` and `style.css` in the release.

The approved story has eight stages, immediate Next actions, persistent cards, rolling/colliding token balls, yield pouring, winner choreography, hatch settlement, gradual ticket reset, a green-win celebration and withdrawal. The same real form state returns on exit.

All amounts, tokens, tickets and outcomes shown by the demo are illustrative. UI tests do not certify production withdrawals or protocol health.

## Local review

From `web`:

```sh
VITE_V5_UAT=true VITE_CHAIN_ID=10143 ./node_modules/.bin/vite --host 127.0.0.1 --port 4180 --strictPort
```

Review the actual integration at `http://localhost:4180/`. Its borderless entry sits beside **Next prize draw**. The UAT configuration is local only and must not be copied into production.

The original standalone study remains available at `/prototypes/deposit-story.html`; it is a development reference, not the approved production layout.

## Checks

```sh
node --test src/components/depositStoryMotion.test.js src/prototypes/deposit-story/story.test.js
node scripts/test-deposit-story-integration.cjs
node scripts/test-deposit-story-transitions.cjs
node scripts/test-deposit-story-focused.cjs
node scripts/test-approved-ui-shell.cjs
```

Browser scripts require Playwright/Chromium. Optional `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` select host installations. Local evidence is written under ignored `.preview-qa/`; do not commit screenshots or downloaded browser libraries. `test-deposit-story.cjs` tests the standalone reference on port 4179.

Passing tests is not authorization to redesign the approved visuals or deploy production. Follow the builder handoff and canonical staging/Vercel release checks.
