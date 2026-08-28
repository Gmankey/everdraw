# V5 External Audit Retest Remediation Evidence - 2026-08-28

**ADR:** ADR-0048
**Audit input:** `tasks/v5-external-audit-remediation-retest-report-2026-08-27.md`
**Base:** `staging` at `056ff47`
**Scope:** M-01, M-02, M-03, M-04, M-06, M-07; informational I-01 through I-04

## Finding closure map

| Finding | Remediation | Regression evidence |
|---|---|---|
| M-01 | Explicit chain/vault/DrawManager/ClaimManager deployment scopes; independent derivation; ambiguous config rejected | `deriveV5DeploymentIsolation.test.ts`, `config.test.ts` |
| M-02 | Claim leaf/domain and draw algorithm v3; explicit Winner/Fee/Reward kind; only Winner drives auto-compound and winner attribution | `ClaimManagerV5.t.sol`, JS/Python differential fuzz, `deriveV5Lifecycle.test.ts` |
| M-03 | Positive confirmations, canonical cursor hash/history, divergence detection, safe rewind, orphan deletion, deterministic rebuild, health fields | `canonicalReorg.test.ts` |
| M-04 | Contract-wide reward mutation lock around funding and cancellation | four callback-token tests in `DrawManagerV5.t.sol` |
| M-06 | Reown replacement, exact direct versions, patched transitive overrides, all locks, full-SHA Actions, digest images, SBOM/scan/provenance workflow | frontend lint/build, docs build, local CycloneDX generation, PR release-sbom check |
| M-07 | Required success heartbeat; alert fallback causes process exit; Fly/runbook configuration and five failure drills | 18 keeper tests including missing-heartbeat startup and both-alert-routes-down |
| I-01 | Frontend lint errors removed | web lint passes |
| I-02 | Independent watcher publishes matched v3 proofs to authenticated persistent indexer storage; History batches all unclaimed winner leaves into one claimMany transaction | claim-proof validation/repository, watcher publication, and frontend batching tests |
| I-03 | Removed unreachable out-of-scope error range split | watcher input tests |
| I-04 | Added winner-role, canonical reorg, deployment isolation, keeper-death, and reward callback coverage | dedicated fixtures listed above |

## Contract and root evidence

- `forge test --summary`: 336 passed, 0 failed, 1 skipped.
- The skipped suite is `PrizeVaultV5ForkTest`; this local-only pass intentionally had no archive
  `MONAD_MAINNET_RPC_URL`. The previously verified Cancun fork command remains the release gate.
- Invariants: 5,000 runs and 250,000 calls per invariant campaign, zero handler reverts.
- M-04 adversarial coverage:
  - same-token callback rejected;
  - cross-token callback rejected;
  - native callback rejected;
  - chained callback rejected;
  - active schedule count never exceeds 16.
- Worst-case bounded schedule finalization:
  `test_rewardSchedulesExpireAtCapWithinGasBudget` passed at 3,782,184 gas.
- `npm run draw:fuzz`: 1,000 JS/Python parity cases passed with v3 leaves.
- Watcher input builders and developer algorithm documentation now emit v3 metadata.

## Indexer evidence

- `npm run build`: TypeScript passes.
- `npx tsx --test src/**/*.test.ts`: 17 passed, 0 failed.
- Deployment-isolation fixture overlaps two stacks with the same wallet, draw ID, and period and
  proves isolated tranches, resolved bases, entries, points, winners, and position events.
- Lifecycle fixture covers two winners, two fee recipients, a reward leg, fee-before-winner payment,
  auto-compound, deferred winner, and deferred payment without false winner attribution.
- Deep and shallow reorg fixtures replace Deposit, Transfer, SeedReceived, RootProposed,
  RootFinalized, ClaimPaid, and PrizeCompounded rows and assert stale transaction removal.
- Health exposes `confirmedHead`, `canonicalHash`, and `rewindCount`.

## Keeper and watcher evidence

- `npm run keeper:v5:test`: 18 passed, 0 failed.
- `npm run draw:watch:test`: 17 passed, 0 failed.
- Managed UAT and mainnet configs set `KEEPER_REQUIRE_HEALTHCHECK=true`.
- Missing success URL exits at startup.
- If Telegram and failure-ping delivery both fail for an actionable condition, the supervisor stops
  its child and exits nonzero so the independent success deadline expires.
- Terminal claim quarantine remains nonfatal and does not flap the dead-man check.
- The mainnet runbook requires observed process-exit, machine-stop, RPC-loss, network-isolation, and
  dual-alert-transport-failure drills. Those are operational UAT acceptance, not simulated as live
  network actions in this code-only PR.

## Frontend, docs, and release evidence

- `web/npm run lint`: pass.
- `web/node --test src/*.test.js`: 35 passed, 0 failed.
- `web/npm run build`: pass.
- `docs-site/npm run build`: pass, 30 static/SSG pages generated.
- Root Hardhat build: pass with EVM target Paris.
- ABI freshness and production source manifest checks: pass.
- Local CycloneDX SBOM generation succeeded for root, web, indexer, and docs:
  - root: 360,291 bytes;
  - web: 592,689 bytes;
  - indexer: 223,196 bytes;
  - docs: 657,193 bytes.
- CI `release-sbom` installs every lock, records lock/SBOM SHA-256 values and runtime versions,
  scans the locked tree with Grype, and uploads a 90-day artifact named with the immutable git SHA.
- All workflow actions are pinned to 40-character commits. Keeper/indexer Docker bases are pinned to
  `node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`.

## Dependency disposition

- Removed direct deprecated `@web3modal/ethers`.
- Added exact `@reown/appkit@1.8.21` and `@reown/appkit-adapter-ethers@1.8.21`.
- Raised vulnerable runtime paths to `ws@8.21.0`, `hono@4.12.25`, `postcss@8.5.26`, `sharp@0.35.0`, and `next@16.3.3`.
- Overrode transitive Axios to patched `1.18.0`; installed tree confirms the override.
- Overrode docs `@xmldom/xmldom` from warned `0.9.10` to `0.9.12`.
- Migrated the docs site from Nextra 3 Pages Router to Nextra 4 App Router/content-directory structure while preserving all public routes and redirects.
- Pinned `zod@4.3.6` because Nextra 4.6.1 is incompatible with Zod 4.4 strict required-key semantics; the pin is lockfile-enforced and the production docs build passes.
- Residual deprecations, disclosed rather than hidden:
  - Reown's Safe connector still transitively includes deprecated
    `@safe-global/safe-gateway-typescript-sdk@3.23.1`; EverDraw does not call it directly and the
    maintained Reown parent has no replacement release that removes it.
  - Nextra transitively includes deprecated `mathjax-full@3.2.2`; this is docs-only.
  - Hardhat/indexer install tooling reports deprecated build/install helpers; these are not browser
    or contract runtime dependencies.
- These residual paths remain locked, SBOM-visible, and subject to the CI fixed-High vulnerability
  gate. Any fixed High finding blocks release rather than being silently accepted.

## Remaining external gates

1. Run the Cancun real-shMON fork suite with the approved archive RPC.
2. Fresh UAT proves matched proof publication, wallet proof retrieval, and one-transaction self-claim.
3. Fresh UAT executes and records all five M-07 dead-man drills.
4. Re-auditor retests the exact merged commit. Mainnet remains blocked until that verdict.
