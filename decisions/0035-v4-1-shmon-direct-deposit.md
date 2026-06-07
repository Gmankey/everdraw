# ADR-0035 — V4.1: native shMON direct deposit (priority, pre-launch)

- **Status:** Proposed (pending operator confirmation of the two open choices below)
- **Date:** 2026-06-07
- **Deciders:** Operator (PM)
- **Relates to:** ADR-0032 (V4 launch record), ADR-0033 (cadence re-anchor), ADR-0010 (two-vault stagger), `tasks/feature-parity-checklist.md`
- **Corrects:** an earlier same-day draft proposed *deferring* shMON deposit on a read of "no real demand." That read was wrong — Merkl and shMonad are building points for shMON deposits and shMON is expected to be the largest deposit asset at launch. The deferral is withdrawn; this ADR replaces it.

## Context

V4 currently accepts **MON only** (native mode: `msg.value` → staked to shMON via `yieldVault.deposit`). An shMON holder must unwrap shMON→MON to participate, only for the vault to immediately re-stake MON→shMON. For the asset expected to dominate deposits at launch, that round-trip is backwards.

This is **pre-launch**: the live vaults exist but the marketing/points launch (where shMON deposits are expected to be the biggest) has not happened. Fixing the deposit asset now — before that launch, while real TVL to migrate is minimal — is low-regret. It is **not** the reactive-redeploy thrash ADR-0033 warned about; it is getting the primary deposit asset right once, before scale.

shMON deposit was stubbed in V3 with **no ADR** and inherited as a gap into V4. This ADR is the missing design record.

## Decision

Ship a bounded **V4.1** that **adds** a direct shMON deposit path **alongside the existing native MON path** — purely additive — then redeploy through the standard guardrails. The native MON on-ramp is retained unchanged. ("shMON-only" was never a considered design and is explicitly not on the table.)

### Contract change (builder, cites this ADR)

1. **`buyTicketsShmon(uint32 ticketCount)`** — native-asset vaults only:
   - Guards identical to `_buyTickets`: `!stopped`, round `Open`, `block.timestamp < salesEndTime`, `ticketCount > 0`, `whenNotPaused`, `nonReentrant`.
   - `monCost = ticketCount * r.ticketPriceAtRoundOpen` (same per-round price snapshot as MON buys — a shMON ticket costs the same MON-denominated amount).
   - `requiredShares = yieldVault.convertToShares(monCost)`, **rounded up** so the vault never under-collects.
   - Pull shMON directly: `yieldVault.transferFrom(msg.sender, address(this), requiredShares)` (measure actual received to be transfer-safe). **No staking step** — the shares are already shMON.
   - Credit exactly as the MON path does: `principalAsset += monCost`, `principalShares += requiredShares`, `totalUnclaimedShares += requiredShares`, round totals, `_activePrincipal += monCost`, `_totalSupply += monCost`, ticket ranges, `Deposit` / `TicketsBought` events.
   - Net effect: a MON depositor and an shMON depositor in the same round are accounted **identically in share terms**; settlement, forfeit, and withdraw math (already share-based) work unchanged for both. Both withdraw shMON shares (already the case), so shMON depositors are now fully symmetric (shMON in → shMON out).

2. **`getWithdrawableShares(uint256 rid, address user) view`** — exposes the exact share amount `withdrawPrincipal` would return (principal share + pro-rata forfeit bonus), so integrators stop replicating settle-math off-chain. (Parity-checklist minor gap; bundled because we are already cutting a release.)

3. **`getRoundTicketPrice(uint256 rid) view`** — returns `ticketPriceAtRoundOpen` for the round. Added as a **separate** getter (not folded into `getRoundInfo`) to avoid breaking the existing tuple ABI. Closes the "price snapshot is unreadable on-chain" gap (integration-doc item).

Nothing else is bundled. Scope is deliberately small to keep the audit/redeploy fast and the diff reviewable.

### Deploy / rollout (through guardrails)

- Re-verify **every** parity-checklist row on-chain after deploy (the reusable gate).
- Deploy **two** V4.1 vaults through the **cadence stagger guard** (ADR-0010) so anchors land 3.5 days apart. See open choice #2 on timing.
- Stop the old V4-A / V4-B vaults (`stop()`), cut frontend + keeper + indexer to the new addresses, record new addresses/anchors/oracle/bytecode-hash in the manifest and ADR-0032.
- **Single Merkl submission on the V4.1 addresses** — do not submit the current MON-only addresses first. Coordinate so Merkl/shMonad index the V4.1 vaults from the start (avoids a resubmission).

## External dependencies (working-rule #5)

| Dependency | Used for | Failure model |
|---|---|---|
| `yieldVault.convertToShares` (ERC-4626 view) | Price an shMON deposit in MON-equivalent terms | Reverts → deposit reverts, user retries (safe). Mispricing only if shMON's exchange rate is itself wrong; rate is yield-driven, not a flash-manipulable spot price, and the protocol already trusts shMON to hold 100% of principal — no *new* trust surface, but record it. |
| `yieldVault.transferFrom` (ERC-20) | Pull shMON shares from the depositor | Needs prior approval; missing approval/balance → revert (safe). Measure actual received to stay transfer-safe. |

No new oracle, keeper, or off-chain dependency is introduced.

## Open choice (operator to confirm before builder code)

**Deploy timing under the stagger:** anchors must be 3.5 days apart (ADR-0010, now machine-enforced). Proposed: deploy **V4.1-A now and V4.1-B at +3.5 days** (clean stagger, vault B joins mid-ramp). Alternative schedules can be tied to the launch date if preferred.

(Deposit assets are **not** an open choice: V4.1 keeps native MON and adds shMON — additive. shMON-only was never considered.)

## Consequences

- shMON holders deposit natively; shMON deposits can lead at launch as expected; Merkl indexes the right addresses from day one.
- One more deploy, but pre-launch and low-TVL — the right-once cost, not recurring churn. ADR-0033's anti-thrash intent is preserved by routing this through the parity gate, the stagger guard, and a single Merkl submission rather than a scramble.
- After this, the deposit surface is correct for the launch that matters; remaining vision gaps stay in V5 (ADR-0034).
