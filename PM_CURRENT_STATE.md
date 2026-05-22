# EverDraw PM Current State

Last updated: 2026-05-22.

This file is the starting point for any fresh PM, builder, reviewer, or deployment operator. Do not reconstruct production behavior from chat history. Start here, then read the linked ADRs and deployment manifest.

## Hard Rule

Production must never be ahead of Git.

No contract deploy, VRF launch, vault replacement, frontend integration, or keeper change is valid unless the repo contains the exact source, ABI/artifact, constructor args, deployment address, compiler settings, and bytecode verification evidence.

If the chain and this repo disagree, stop. Recover and verify source before continuing.

## Canonical Branch And Repo

- GitHub repo: `Gmankey/everdraw`
- Production branch: `staging`
- Production Vercel project: `everdraw`
- Production domain: `everdraw.xyz`
- Deployment manifest: `deployments/monad-mainnet.json`

## Current Production Contracts

### Vault A

- Address: `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888`
- Status: active
- Source: `src/TicketPrizePoolShmonV2.sol`
- ABI: `abi/TicketPrizePoolShmonV2.json`
- Verification: `decisions/0016-production-v2-source-recovery.md`
- Runtime bytecode hash: `a8a7e930e3fde441e95f68966e94b3e7d533e92facfc5ab3aa6ef4d61a23bfd3`

Important behavior:

- `settle()` computes `principalShares = shmon.previewDeposit(totalPrincipalMON)`.
- `prizeShares = totalShmonShares > principalShares ? totalShmonShares - principalShares : 0`.
- `withdrawPrincipal()` returns exact deposited shares only when `prizeShares == 0`, skipped, or failed.
- In profitable settled rounds, `withdrawPrincipal()` returns fair-value shares:
  `principalSharesAtSettle * userMON / totalPrincipalMON`.
- `claimPrize()` does not zero `prizeShares`; `prizeShares` is a permanent settlement record.

### Legacy Vault B

- Address: `0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a`
- Status: retiring-monitoring-only
- Source listed for legacy tracking: `src/TicketPrizePoolShmonShMonad.sol`
- ABI: `abi/pool.verified.json`
- Verification status: unverified-retiring
- Live runtime bytecode hash: `220cafb32f6c2d8ca7587b6fa6cd388434a007875e643a230b6f39db82a7a8c3`

Do not use this contract as source for new designs. Keep it only for in-flight settlement/claims per ADR-0011. Current committed source/artifacts and available local backups did not match live runtime bytecode, so this contract is explicitly quarantined rather than treated as a source of truth.

## V3 / VRF Work

- Source: `src/TicketPrizePoolShmonV3.sol`
- Tests: `test/TicketPrizePoolShmonV3.t.sol`
- ABI: `abi/TicketPrizePoolShmonV3.json`
- VRF launch ADR: `decisions/0014-vrf-launch-requirement-pyth-entropy.md`
- VRF failover ADR: `decisions/0015-vrf-failover-playbook.md`

V3 is aligned to production V2 accounting:

- Uses `previewDeposit`, not `convertToShares`.
- Keeps `prizeShares` as a permanent settlement record.
- `withdrawPrincipal` uses `prizeShares == 0` for exact-share returns; otherwise fair-value shares.
- `claimPrize` gates double claims with `prizeClaimed` and does not mutate `prizeShares`.

V3 is not production-deployed from this repo state unless a later deployment manifest entry says so.

## Required Verification Commands

Run these from a clean checkout before accepting any contract change:

```bash
npm ci
npm run build
npm run check:abi
npm run check:deploy-source
~/.foundry/bin/forge test
```

Optional live bytecode verification for active manifest entries:

```bash
npm run check:bytecode
```

Mainnet deploys must use:

```bash
npm run deploy:mainnet
```

That command runs deploy preflight and refuses dirty, unpushed, or non-`staging` deploys.

Direct broadcast commands are not valid release procedure:

- Do not use `npx hardhat run ... --network monadMainnet` directly.
- Do not use `forge script ... --broadcast` directly.
- Do not use `cast send` for deployments.

For Forge-based mainnet deployment work, use `npm run deploy:forge:mainnet` or another committed wrapper that runs `npm run deploy:preflight` first.

## Open Items

- Vault B replacement deploy per ADR-0011 remains outstanding.
- V3 testnet deploy and smoke test remain outstanding.
- Low-balance VRF reserve monitoring in keeper remains outstanding.
- Legacy `0xed67...` is unverified-retiring and quarantined. Do not rely on its exact behavior for future work.

## Incident Lesson

The production V2 source was previously deployed from uncommitted local state and recovered from a housekeeping backup. That must not recur. Any future production source gap is a release blocker, not a documentation task.
