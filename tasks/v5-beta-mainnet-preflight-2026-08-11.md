# V5 beta mainnet preflight evidence - 2026-08-11

**Scope:** no-key local source and test gates on `codex/v5-beta-launch-preflight`, based on
`origin/staging` merge commit `0a90d6f459c5c81a0677cdc39807d7e69027db61`.

This record does not represent a mainnet deployment and no live-network or signer-bearing command
was run.

## Launch-scope decision

The operator deferred Merkl/shMonad campaign activation until after the beta has users. The Patron
Pool launches with boosted EverDraw points. The distinct Patron event stream remains available for
a later campaign, but Merkl registration and a shMonad multiplier are not beta launch gates.

ADR-0040 and the launch-readiness checklist have been reconciled to that decision.

## Local gates

The following commands passed:

```bash
npm run build
npm run check:abi
npm run check:deploy-source
node --test scripts/deploy-v5-mainnet.unit.test.mjs
forge test
```

Results:

- Hardhat compiled 24 Solidity files for the production `paris` target.
- All checked ABIs were fresh.
- `deployments/monad-mainnet.json` passed the production source-manifest check.
- Mainnet deploy configuration tests: 4 passed, 0 failed.
- Forge: 304 passed, 0 failed, 1 skipped.

The skipped Forge suite is `test/v5/PrizeVaultV5Fork.t.sol`, which requires the operator's
mainnet archive-capable RPC and the isolated Cancun fork profile. That gate was already rerun by
the operator against real shMON: 6 passed, 0 failed. It does not change the production `paris`
artifact target.

## Deliberately pending

`npm run deploy:preflight` was not bypassed or weakened. It requires a clean local `staging`
whose HEAD exactly matches `origin/staging`; this feature branch correctly cannot satisfy that
deployment-source guard. The operator must run it from clean `staging` after this PR merges and
immediately before the signer-bearing mainnet flow.

This evidence does not close:

- the remaining clean UAT soak branches listed in `tasks/v5-launch-readiness-checklist.md`;
