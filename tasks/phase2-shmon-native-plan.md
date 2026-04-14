# Phase 2 — shMON-Native Vaults: Master Plan

**Status:** Planning complete, ready for build
**Owner:** PM → Builder (specs in sibling files)
**Date:** 2026-04-08
**Target:** Deploy as **Vault C** on Monad mainnet (parallel to V1 Vaults A & B)

---

## TL;DR

V2 (`TicketPrizePoolShmonV2`) **always returns shMON to users** — contract never unstakes. Rounds settle in seconds via blockhash finalization (no unstake epoch wait). Users who want MON back manage unstaking themselves via a new shMON management UI on everdraw.xyz (shipped first in Phase 2c, zero contract risk).

**Key insight:** shMON has two unstake paths — instant (`redeem()`, ~0.975% fee) and scheduled (`requestUnstake()` → ~18-22 hr wait → `completeUnstake()`, free). V1 used the slow path internally. V2 puts that choice in the user's hands.

**Reporting scope:** Capped at the moment shMON leaves our contract. Post-return user behavior is not our data.

---

## Goals

1. **shMON deposits** — users pay tickets in shMON directly (no staking wait).
2. **shMON settlement** — principal and prize always returned as shares. Rounds settle instantly after target block.
3. **Frictionless re-entry** — one-click next-round entry with existing shMON balance.
4. **User-controlled unstaking** — standalone shMON panel lets users pick instant (fee) or scheduled (free) MON conversion.

## Non-goals

- Mid-round withdrawal preference toggles (removed)
- Split-unstake cohort logic in contract (removed)
- Winner denomination branching (removed)
- Post-return user tracking in indexer (removed per scope cap)
- Upgrade path for V1 Vaults A/B (they stay running until organic migration)

---

## Architecture

### State machine
```
Open (24hr sales) → Committed (target block set) → Settled (blockhash → winner + yield)
      │                    │                              │
      │ no tickets         │ blockhash expired (>255 blks)│
      ▼                    ▼                              ▼
   Skipped              Failed                    withdrawPrincipal
                                                   claimPrize
```

**Removed from V1:** `Finalizing`, `requestUnstake`, `completeUnstake`, `unstakeCompletionEpoch`, `monReceived`, `lossRatio`, finalization timeout, finalization busy slot.

### Settlement math
```
principalShares = shmon.previewDeposit(totalPrincipalMON)   // shares covering principal at settle-time rate
prizeShares     = totalShmonShares - principalShares        // everything extra = yield
```
Loss case (rate dropped): saturating subtract → `prizeShares = 0`, users withdraw their original shares unchanged (share-level no-loss preserved).

### Deposit paths
```solidity
function buyTicketsMON(uint32 n)    external payable;  // stake MON on entry (V1-compatible UX)
function buyTicketsShmon(uint32 n)  external;          // transferFrom exact shares for cost MON
```
Both converge to `_recordPosition()` — one position per (round, user), aggregated across buys.

---

## shMON verification findings (2026-04-08)

Confirmed on mainnet against `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`:

| Surface | Status | Notes |
|---|---|---|
| `asset()` | ✓ | Returns `0xEEE...E` (native MON sentinel) |
| `previewDeposit/Withdraw/Mint/Redeem` | ✓ | Use these for all conversions |
| `convertToAssets` | ✓ | For rate snapshots |
| `convertToShares` | ✗ reverts | **Use `previewDeposit` instead** |
| `name()`, `totalSupply()` | ✗ revert | Harmless |
| `transfer`, `approve`, `transferFrom` | ✓ | Standard ERC-20 |
| `redeem()` / `withdraw()` | ✓ callable | Instant path, ~0.975% fee baked in |
| `requestUnstake()` / `completeUnstake()` | ✓ callable | Slow path, free, ~18-22hr |
| Current rate | 1 share ≈ 1.537 MON | Rate floats; snapshot at every event |
| Round duration | 86400 sec (24hr) | Confirmed from live pool |

---

## Reporting decisions

- **Dual-denomination events** — every event emits shares + MON-equivalent + rate snapshot.
- **Flow metrics** (deposits, prizes) — use MON-at-event-time for cross-time comparability.
- **Stock metrics** (current TVL) — mark-to-market via `convertToAssets(totalShares)`.
- **APY** — inherit shMON base APY; we don't generate alpha, we redistribute yield via lottery.
- **No-loss wording update:** *"Your principal is preserved in shMON shares. You'll receive the same shares you deposited."*
- **Scope cap** — we track up to the moment shMON leaves our contract. No downstream data.

---

## Rollout phases & order

### Phase 2c — shMON unstake widget (ship first)
Standalone UI at `everdraw.xyz/shmon`. Works with any shMON regardless of source. Zero contract risk.
- **Spec:** `phase2-builder-spec-c-shmon-widget.md`
- **Effort:** 2-3 days
- **Risk:** Low

### Phase 2a — V2 contract + frontend + keeper
`TicketPrizePoolShmonV2.sol` deployed as Vault C, new buy/withdraw UI, updated keeper.
- **Spec:** `phase2-builder-spec-a-v2-contract.md`
- **Effort:** 4-5 days contract + 2 days frontend + 1 day keeper
- **Risk:** Medium

### Phase 2b — Test suite
Foundry unit (mock shMON) + fork tests (real shMON) + optional Playwright E2E.
- **Spec:** `phase2-builder-spec-b-test-suite.md`
- **Effort:** 3-4 days
- **Risk:** Low

**Can be built in parallel once (a) contract spec is frozen.** (c) is independent and ships first.

---

## Deployment sequence

1. Ship 2c widget to production (V1 users can use it with existing shMON)
2. 2a contract + 2b tests green locally
3. Internal review + slither/semgrep clean
4. Deploy V2 to Monad testnet, run 3+ rounds via keeper
5. Mainnet deploy as **Vault C** with low ticket price (0.1 MON) for burn-in
6. Monitor 2+ rounds with TG alerts
7. Raise Vault C ticket price to match A/B if stable
8. (Later) organic migration of Vault A/B users

---

## Open questions (decide during build)

1. **`previewWithdraw` rounding** — add `+1` buffer in contract vs frontend. Decide after fork test.
2. **Approval UX default** — exact-amount vs MAX_UINT. Default: exact + "approve unlimited" checkbox.
3. **Pending unstake accessor on shMON** — on-chain getter or scan `UnstakeRequested` events? Discover during 2c build.
4. **Multiple simultaneous pending unstakes** — list vs single-slot UI? Determines 2c behavior.
5. **Vault C burn-in ticket price** — 0.1 MON recommended.
6. **Failed round principal recovery** — treat like Skipped for `withdrawPrincipal`. Confirmed in (a) spec.

---

## Memory index entry

Add to `~/.claude/projects/--wsl-localhost-Ubuntu-home-c--openclaw/memory/MEMORY.md`:
```
- [project_everdraw_phase2.md](project_everdraw_phase2.md) — Phase 2 shMON-native vaults plan
```
