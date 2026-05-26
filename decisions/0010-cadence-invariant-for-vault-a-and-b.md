# ADR-0010 — Cadence invariant for Vault A and Vault B contracts

**Status:** Accepted
**Date:** 2026-05-20
**Deciders:** User + Claude (PM)

## Context

ADR-0001 commits us to two vaults on offset weekly schedules, surfaced in the UI as **"Vault A"** and **"Vault B"** tabs. From the user's perspective those labels are permanent — the underlying contracts behind each label can be replaced, redeployed, or retired over time, but a user never needs to learn about that churn. They see Vault A and Vault B, and each one has a predictable weekly opening.

For that abstraction to hold, the two contracts currently filling the Vault A and Vault B roles must behave identically except for their schedule anchor. If their cadence parameters differ, users see two vaults that "feel" different (one settles a day later than the other, one weekly anchor drifts relative to the other), the 3.5-day offset breaks, and we get questions we can't answer.

This was not an invariant in the codebase. It was implicit in ADR-0001's intent but never codified. In May 2026 we discovered that the contract filling the Vault B role at the time (`0xed67ad46…`) had a different `yieldPeriodSec` than the contract filling Vault A (`0x2208a2Fe…`) — 604800 (7d) vs 518100 (~6d) — making it an 8-day cycle that did not align with the weekly Sun anchor. The mismatch made it through deployment because no ADR pinned the values, and the deploy script appears to have been written from memory of a prior deploy.

## Decision

### Cadence invariant

Both contracts currently assigned to the Vault A and Vault B UI roles **must** share the following constructor parameters exactly:

| Param | Required value |
|---|---|
| `roundDurationSec` | `86400` (24h deposit window) |
| `yieldPeriodSec` | `518100` (≈ 5d 23h 55m yield phase) |
| `ticketPriceMON` | `1000000000000000000` (1 MON) |
| `shmon` | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` (mainnet shMON) |
| Contract code | Same V2 bytecode (current `TicketPrizePoolShmonV2`) |

Schedule anchors are calendar-fixed and offset by 3.5 days:
- **Vault A:** Wed 13:00 UTC (round opens), Thu 13:00 UTC (deposits close), settle ~next Wed.
- **Vault B:** Sun 01:00 UTC (round opens), Mon 01:00 UTC (deposits close), settle ~next Sun.

(Vault B's anchor was updated from the original Sun 13:42 UTC of ADR-0001 to align with a cleaner UTC slot at the time of its replacement contract deploy — see ADR-0011.)

### What is allowed to differ

Only ownership wallet may vary between the two contracts, and even that is discouraged. Default: same owner. See ADR-0011 for the current state and remediation plan.

### How this invariant is enforced

1. **Any deploy of a contract that will fill the Vault A or Vault B role must cite ADR-0010** in the builder ticket. The constructor args are copied **from this ADR**, not from a previous deploy or chat history.
2. **Post-deploy verification (mandatory):** the deploy ticket is not closed until `cast call <addr> 'roundDurationSec()' / 'yieldPeriodSec()' / 'ticketPriceMON()' / 'shmon()'` for both active contracts returns the exact values in the table above, side-by-side.
3. **If a value is wrong:** the contract **cannot** be promoted into a UI vault role. `yieldPeriodSec` and the other constructor params are immutable. The only remediation is redeploy. See ADR-0011 for the playbook.
4. **Schedule changes** (e.g. moving Vault B's anchor from Sun 13:42 to Sun 01:00) require an ADR amendment to this document **before** the next replacement deploy.

### UI labels are permanent

The strings "Vault A" and "Vault B" never change in the UI. Users do not see contract addresses, deploy generations, or migration history. If the contract behind Vault B is replaced 5 times, it is still "Vault B" in the UI on day 1 and on day 365.

Internally, builder tickets / ADRs / runbooks may refer to specific contracts by address or generation. They must never invent new UI-facing names like "Vault C / D / E" — those are internal-only shorthand and must not leak into the frontend, docs, or marketing.

## Rationale

- The two-vault staggered cadence in ADR-0001 is a product promise. A 7d vs 8d mismatch silently breaks that promise.
- Pinning values in an ADR + mandatory verification step closes the gap that allowed the May 2026 mismatch.
- Keeping UI labels stable across contract churn protects the user mental model while we still iterate on contract code.

## Alternatives considered

- **Codify in `foundry.toml` or a deploy-script constant instead of an ADR.** Rejected — the constants would still need a source-of-truth doc explaining *why* those values, and an ADR is that doc. A deploy-script constant block can co-exist and reference this ADR.
- **Make `yieldPeriodSec` mutable so we can fix in place.** Rejected — adds an owner-only knob that changes round economics mid-flight; trust-minimization cost outweighs the convenience.
- **Allow per-vault cadence customization (different yield periods for A and B as a feature).** Rejected — it would require a different UI surface ("Fast Vault" / "Slow Vault") and a different ADR-0001. Not a Phase 1 product call.

## Consequences

### Process
- Builder deploy template (`scripts/deploy-*.js`) updated to read constructor args from this ADR's table by reference.
- New step in deploy checklist: side-by-side `cast call` verification of all five values across both active vault contracts.
- Cadence ADRs (this one + ADR-0001) become required reading before any V2 vault redeploy.

### Existing state
- `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888` (currently Vault A): compliant.
- `0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a` (currently Vault B): **non-compliant**, `yieldPeriodSec=604800`. Remediation in ADR-0011.

### Future
- If we ever decide to run a 3-vault rotation, this ADR is amended to cover all three. Same invariant — they all share cadence.

## Related ADRs

- ADR-0001 — Two-vault staggered deposit cadence (introduced the schedule but did not pin params)
- ADR-0003 — Migration of current Vault A and Vault B deployment (original two-vault deploy)
- ADR-0011 — Vault B contract replacement (May 2026 cadence mismatch remediation)
