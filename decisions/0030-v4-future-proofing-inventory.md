# ADR-0030 — V4 Future-Proofing Inventory

**Status:** Accepted.
**Date:** 2026-06-02
**Parent:** ADR-0024 (V4 contract spec).

## Context

V3 had to be redeployed as V4 because a third-party integrator surface (Merkl) was dropped without anyone noticing until after mainnet. The emergency was preventable. The lesson is: when you redeploy, you absorb every *currently known* deferred item that requires contract storage or immutable config, because the next opportunity to add them is the next redeploy.

This ADR is the explicit inventory of what V4 enables today, what V4 defers to V4.1+, and the path to enable each deferred item without another emergency. It exists so that the next agent or operator can answer "do we need to redeploy for X?" by looking it up rather than re-deriving.

## What V4 enables today (operator can turn on without redeploy)

| Capability | Mechanism | ADR |
|---|---|---|
| **Multi-recipient protocol fee** | `setFeeAllocations` — up to 8 recipients, sum ≤ 2000 bps, per-round snapshot | ADR-0027 |
| **Multi-winner rounds** | Set at construction (1..32, allocation sum 10000). Different vaults can ship different shapes. | ADR-0025 |
| **Sponsor drop-in cash** | `sponsor` / `sponsorERC20` open per round, yields accrue, refundable on skip/force-settle | ADR-0026 |
| **Generic asset (ERC-20 mode)** | `depositMode=ERC20` + `asset=<token>` at construction. Native MON or any ERC-20. | ADR-0024 §4 |
| **Mutable ticket price** | `setTicketPrice(newPrice)` with 10x bounds, per-round snapshot | ADR-0024 §6 |
| **Randomness oracle swap** | `queueOracleChange` + 24h timelock + `commitOracleChange`. Lets us migrate off Pyth without a new vault. | ADR-0029 |
| **Transfer-failure resilience** | `_transferOrDefer` wraps every yield-vault transfer; deferred claims always retriable | ADR-0028 |
| **Graceful stop** | `stop()` is the one-way brake; claims/withdraws still work after | ADR-0024 §5 |
| **Pauser/owner separation** | `setPauser` for an independent on-call wallet | ADR-0024 §8 |
| **Per-round metadata** | `setNextRoundMetadata(campaign, bytes32)` for sponsored/campaign rounds | ADR-0021 + ADR-0024 §7 |
| **Merkl-readable position surface** | `balanceOf`, `totalSupply`, `name`, `symbol`, `decimals`, `Deposit`, `Withdraw` permanent | ADR-0006 + ADR-0024 §3 |

## What V4 defers, with the path to enable

| Deferred capability | Why deferred for V4 | Path to enable | Requires redeploy? |
|---|---|---|---|
| **Sponsor stake-yield** (sponsor keeps principal, donates only yield) | Materially more complex accounting (separate principal mapping, per-sponsor refund flow, fee math distinguishing yield-on-depositor vs yield-on-sponsor). ~200 lines + audit surface. | New vault contract `TicketPrizePoolV4_StakeYield` (V4.1). Co-exists with V4. | **Yes**, new vault. V4 drop-in continues working. |
| **Factory pattern for per-vault deployment** | V4 deploys are still rare enough (2 vaults) that hand-running the script is fine. Factory adds surface without yet-needed benefit. | Build `EverDrawVaultFactory` later — emits `VaultDeployed` events, registers oracles via predicted-address pattern. V4 vault implementation unchanged. | No for V4. Yes for factory itself. |
| **Pause hub** (single multisig pauses all vaults at once) | V4 has 2 vaults; manually calling `pause()` on each is acceptable. Hub would add a hub-trusts-everyone surface. | Build `EverDrawPauseHub` contract that holds `pauser` role on each vault. Owner of each vault calls `setPauser(hub)`. Hub is admin-only. | No. Hub is additive; can be added or removed by per-vault `setPauser`. |
| **MegaDraw** (cross-vault prize pool combination) | Needs cross-vault aggregation, which is a new architectural layer. | Build separate `MegaDrawCoordinator` that pulls yield from multiple vaults via a new `delegateYieldToCoordinator` function. **Requires V5 redeploy or a new vault.** | **Yes**. Flag for V5. |
| **TWAB / "Keep Playing"** | Time-weighted average balance tracking per ADR-0007 was deferred to Phase 2. Adds significant storage cost per deposit. | Requires per-deposit storage hooks — not present in V4. **Requires V5 redeploy.** | **Yes**. Flag for V5. |
| **Points system** | Off-chain accrual against on-chain events per ADR-0008 — entirely off-chain, no contract change needed | Run a points-accrual service against V4 indexer. ADR-0008 unchanged. | No. Off-chain. |
| **Sponsor with allocation choice** ("100% to 2nd place") | Per-sponsor allocation overrides per-vault allocation; adds complexity. | If desired, build a wrapper contract that accepts a sponsor + allocation tuple and routes to the right downstream vault. **No V4 change.** | No. Build wrapper. |
| **Per-round sponsor cap** | No demand. Owner can `pause()` if a sweep happens. | Add `maxSponsorPerRound` storage + check in `_sponsor`. **Requires V5 or new vault.** | **Yes if you want enforcement at the protocol level.** Pause is the operator-side mitigation. |
| **Permissionless keeper** | Current keeper is operator-controlled. Open it via `setKeeper(anyone, true)` later if desired. | Owner action only. No contract change. | No. |
| **Cross-chain (Monad → other L1/L2)** | Not in roadmap. | Would need new vault on target chain + bridge. No V4 change. | New deploys per chain. |
| **NFT-receipt position** (transferable position via ERC-721 wrap) | V4 positions are intentionally non-transferable. ADR-0006 records the choice. | Build an outer wrapper contract that ERC-721-tokenizes a wallet's V4 position. V4 unchanged. | No for V4. Wrapper is additive. |
| **VRF redundancy** (multiple oracle providers) | ADR-0029 wraps a single oracle. ADR-0015 covers Pyth failover by oracle swap. | `randomnessOracle` is a single address. To get true redundancy you'd need to deploy a multi-source aggregator oracle that implements `IRandomnessOracle` and arbitrates between providers. V4 contract unchanged. | No for V4. New oracle implementation. |
| **Dynamic VRF fee** (oracle fee changes) | V4 reads `oracle.getFee()` on each commit, so this is already enabled. | No change. | No. |
| **Owner-rotation timelock** | V4 has two-step ownership transfer but no timelock. | Could add a `Timelock` contract that holds owner and queues calls. Build later if needed. | No. Timelock is additive. |
| **Anti-MEV ticket purchase** (commit-reveal or batch auction) | Not in V4 design; tickets are 1 MON each, no front-running surface. | Would require a major round-flow rewrite. **V5.** | **Yes**. Flag for V5. |
| **Yield-vault hot-swap** (move all principal from one yield vault to another) | shMON is the only yield vault we use. Switching would require an audit-heavy migration function. | V5 if needed. Or run new vaults pointing at new yield vault and migrate users. | **Yes**. Flag for V5. |
| **Per-vault ERC-20 deposit cap** | No protocol-level demand. | Add `maxDepositPerUser` + check in `buyTickets`. **V5 if needed.** | **Yes** if you want it enforced. |
| **Vault-shutdown depositor sweep** (operator can mass-refund) | Inappropriate — would violate the no-loss promise mid-round. After `stop()`, users withdraw individually. | None. Don't build. | n/a |

## What's worth absorbing into V4.1 specifically

When V4.1 is scoped (probably 3–6 months after V4 ships, once we have real operating data), the high-value items are:

1. **Sponsor stake-yield** — partner protocols specifically asked for this. V4 drop-in is a stepping stone.
2. **Factory** — needed if we scale past ~5 vaults.
3. **Anti-MEV ticket purchase** — only if order flow gets adversarial.
4. **Yield-vault hot-swap** — only if we adopt a second yield vault.

The rest of the list above is either off-chain (points), additive (pause hub, NFT wrapper, timelock), or not yet justified by demand.

## What V5 would unlock (if ever)

- TWAB / Keep Playing (deep storage redesign)
- MegaDraw (cross-vault coordination)
- Major round-flow change (commit-reveal, batch auction)
- Yield-vault hot-swap (migration semantics)

V5 is not scheduled. This list exists so we don't accidentally redeploy V4.x when the change requires V5.

## What is NOT future-proofing (rejected)

- **Upgradeable proxy / UUPS pattern.** Rejected per ADR-0024. The cost (audit surface, governance complexity, user trust) is not worth the benefit (rare upgrades). V4 is immutable; the next break is a new deploy with migration runbook.
- **Storage layout reservation slots.** Rejected. We're immutable; reserving slots gives no benefit and adds reviewer confusion.
- **Generic call hook for owner ("just send any tx")**. Rejected. Permissionless flexibility on owner is an attack surface, not a feature.

## Consequences

- An operator or future agent who wants to know "can we do X without redeploy?" has a one-page answer.
- Items flagged "requires V5" are pre-committed as such. Don't try to retrofit them into V4.x.
- The list is a living document; new deferred items get appended as they come up. Each append must include the path to enable.

## Open questions

- **When is V4.1 scoped?** No date. Triggers: enough sponsor stake-yield demand from partners, OR more than 3 new vaults requested (factory), OR adversarial order flow observed (anti-MEV).
- **When is V5 scoped?** Probably not before 12 months of V4 operation, unless a critical gap surfaces.
