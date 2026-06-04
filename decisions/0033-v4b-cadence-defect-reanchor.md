# ADR-0033 — V4-B Cadence Defect and Re-Anchor Remediation

**Status:** Accepted (remediation in progress).
**Date:** 2026-06-03
**Parent:** ADR-0010 (cadence invariant), ADR-0032 (V4 launch record).

## Context

ADR-0010 pins the two-vault schedule anchors as **calendar-fixed and offset by exactly 3.5 days** (the historical Wed/Sun stagger). This is a product promise: users always have a draw "coming soon," spread across the week.

During the V4 mainnet launch (2026-06-03), V4-A and V4-B were deployed **~55 minutes apart**, not 3.5 days:

| Vault | Round-1 salesEnd (weekly anchor) |
|---|---|
| V4-A (`0x9263d84a141172d9618f4b08839f595EE03bC7E8`) | Thu Jun 4 06:10:23 UTC |
| V4-B (`0x0032c9F6621Ef5d53b48dc602D4d056d7a47c5fF`) | Thu Jun 4 07:05:22 UTC |

Left uncorrected, both vaults open, close, and settle within an hour of each other every week — collapsing the staggered cadence that is the entire reason two vaults exist.

**Root cause:** the PM launch-kickoff doc gave contradictory deploy-timing guidance ("~84h offset… could be 1 hour after… whenever convenient") that was never cross-checked against ADR-0010 before reaching the builder. ADR-0032 (the builder's launch record) documented the deploy as successful but did not catch the cadence violation.

## Decision

**Redeploy V4-B at the correct 3.5-day offset.** Chosen over the two alternatives because zero deposits existed at discovery time, making a clean redeploy free of user impact.

- **Target V4-B redeploy: Sat Jun 6 18:10:23 UTC** (exactly 84h after V4-A's deploy → 3.5-day stagger; V4-A draws ~Thu, V4-B ~Sun).
- V4-A is correct and is **not** touched.

### Containment already executed (2026-06-03)

1. **V4-B paused** on-chain to block any deposit before the redeploy. Tx `0x1889f67c207fb8bd607413226dfec7ab9d0982067036d30ff70fd45bf7d5e35d`, signed by the Ledger owner `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2`. `paused() == true` verified.
2. **9 MON VRF reserve recovered** from V4-B to the Ledger to fund the redeploy. Tx `0x734b70adf1203179fcb49d86b451624e88ea014b6da4f9411c783fabe067991d`. V4-B balance now 0.
3. **Frontend** now renders the standard "Vault Closed" graphic for the paused vault (PR #73, live) so users see a clear closed state, not a broken deposit attempt.

### Saturday remediation steps

Full runbook: [tasks/v4-vaultb-cadence-fix-2026-06-03.md](../tasks/v4-vaultb-cadence-fix-2026-06-03.md). Summary:
1. Redeploy V4-B (`VAULT_SYMBOL=EVRDRAW-B`, identical config to V4-A) at ~Sat 18:10 UTC.
2. Verify, seed 9 MON VRF reserve, `setKeeper`, `setPauser(Ledger)`, `transferOwnership(Ledger)`, operator `acceptOwnership` via Remix.
3. Cut frontend `VITE_POOL_ADDRESSES` second slot + keeper/indexer Fly secrets to the new V4-B address.
4. `stop()` the old V4-B (`0x0032c9F6…`) and mark it retired in `deployments/monad-mainnet.json` + ADR-0032.

## Consequences

- After Saturday, V4-A/V4-B satisfy ADR-0010's 3.5-day invariant.
- The old V4-B address (`0x0032c9F6…`) becomes a retired, stopped contract with no deposits — safe to abandon on-chain.
- `deployments/monad-mainnet.json` and ADR-0032 must be updated with the new V4-B address post-redeploy.
- Merkl registration should wait until after Saturday so the final V4-B address is submitted (not the retired one).

## Process lesson (enforced going forward)

**Deploy timing / cadence is a spec-governed parameter, not an operational convenience.** Every redeploy ticket must cite the ADR-0010 anchor and an exact target timestamp — never "whenever convenient." Cross-check deploy timing against ADR-0010 before any vault deploy reaches the builder. Added to the multi-surface discipline.

## Open questions

- None. Remediation path is fixed; only execution (Saturday) remains.
