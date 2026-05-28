# Post-Sunday Docs Cleanup

**Date filed:** 2026-05-28
**Earliest start:** Mon 2026-06-01 (after Vault B V3 deploys Sun 2026-05-31 01:00 UTC)
**Owner:** Whoever picks it up (you, or a future Claude session)

---

## Why this exists

When the V3 docs sync landed (PR on `docs/sync-docs-site-to-v3`, 2026-05-28), V2 vaults were still active for in-flight finalization. The docs therefore had to describe BOTH the V3 mechanism AND the legacy V2 details, with "V2 (legacy)" sections appended to many pages. The result is verbose — readers see a lot of historical context that doesn't apply to what they should actually do.

Once Vault B V3 deploys and the V2 vaults' remaining rounds settle out, the legacy V2 content becomes pure baggage. This ticket slims it down.

---

## When to start

After **all four conditions** are true:

1. ✅ Vault B V3 has been deployed (Sun 2026-05-31 01:00 UTC scheduled)
2. ✅ Frontend env `VITE_POOL_ADDRESSES_V3` includes both V3 vaults
3. ✅ Any final V2 Vault A in-flight round (the one that was Open at the V3 cutover) has fully settled and all depositors have withdrawn
4. ✅ Vault B V2 (`0xd4F4286...`) is no longer accepting new deposits — confirmed via on-chain `getRoundInfo` and an inspection of MyRounds for any non-zero in-flight principal

Hard target: Mon 2026-06-02 or shortly after.

---

## What to change

### Trim V2-as-legacy noise

| File | Change |
|---|---|
| `docs-site/pages/developers/smart-contract.md` | Remove the "V2 (legacy) reference" section at the bottom. Update the address table: V3 Vault A + V3 Vault B as Active, V2 Vault A + V2 Vault B as Retired (link to retirement explorer view but don't expand). |
| `docs-site/pages/developers/integration.md` | Drop the V2 env var examples (`VITE_POOL_ADDRESSES_V2`, `POOL_ADDRESSES_V2`, `POOL_SCHEDULE_V2`). Keep only V3 vars. |
| `docs-site/pages/developers/keeper-bot.md` | Same — drop V2 env vars from the example. |
| `docs-site/pages/how-it-works/winner-selection.md` | Remove the "V2 vault randomness (legacy)" section. The doc should describe only the V3 Pyth mechanism going forward. |
| `docs-site/pages/security.md` | Drop the V2 Vault A and V2 Vault B rows from the "Verified source" table. Keep only the V3 vaults. Update audit-status section to mention any third-party audit progress at that point. |

### Rewrite the "Multi pool" example in `integration.md`

It currently shows a transitional config with both V2 and V3 lists. Replace with a clean V3-only example:

```
VITE_POOL_ADDRESSES_V3=0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee,<vault B V3 address>
VITE_SHMON_ADDRESS=0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c

POOL_ADDRESSES=<V3 A>,<V3 B>
POOL_ADDRESSES_V3=<V3 A>,<V3 B>
POOL_SCHEDULE_V3=<V3 A>:Wed:13,<V3 B>:Sun:1
```

No V2 lists needed once V2 contracts are no longer keeper-watched.

### Update the address tables

Current address listing on `developers/smart-contract.md` includes 5 rows (V3 Vault A, V2 Vault A retiring, V2 Vault B active, V3 Vault B scheduled, Legacy Vault B quarantined). Reduce to 3 rows:

| Vault | Address | Anchor | Status |
|---|---|---|---|
| Vault A V3 | `0x8F36aaAD...c7B1ee` | Wed 13:00 UTC | Active |
| Vault B V3 | `<new address>` | Sun 01:00 UTC | Active |
| Retired (V2 + legacy) | (link to deployment manifest) | — | Withdrawals only |

The full historical address list lives in `deployments/monad-mainnet.json`. The docs page should link there for anyone who needs the full record but not clutter the main reading flow.

### Consider rewriting `how-it-works/winner-selection.md` intro

The current intro frames V3 as "replacing V2's block-hash scheme." Once V2 is dead, this framing is unnecessary historical comparison. Simplify to: "EverDraw uses Pyth Entropy for verifiable randomness." Then explain the mechanism. The "Why this design" section can drop the "we used to use block hashes" framing.

### Add to `security.md`

Once Vault B V3 has at least one settled round in production:
- Mention "EverDraw has now settled N rounds across both V3 vaults on mainnet" in the "What has been validated" section.

If a third-party audit has started or completed by the time this ticket fires:
- Replace the "internal audit complete, formal audit budgeted" line with the actual third-party status.

---

## What NOT to change

- **Do not delete the V2 address references in `deployments/monad-mainnet.json`.** That file is the historical record per ADR-0017. Mark statuses as "retired" but keep the entries.
- **Do not delete `decisions/` ADRs that reference V2.** ADR history is permanent.
- **Do not delete the V2 source from `src/`** until at least 90 days after the last V2 user has withdrawn. The source must remain reproducible from git for any post-mortem investigation. Tracked separately in `tasks/v2-source-retirement-checklist-TBD.md` (not yet written; file it when this ticket fires).

---

## Deliverable

A single PR against `staging` titled "docs: V3-only baseline after V2 sunset" containing the five doc-page slimdowns. No code changes. Estimated effort: 1 hour.

After merge, the live docs at `docs.everdraw.xyz` should:
- Read like a docs site for a single-architecture product (V3 only)
- Not require the reader to understand the V2/V3 migration to interact with the protocol
- Still link to historical context (ADRs, deployment manifest) for anyone who wants it

---

## Tracked in

- This task file (you're reading it)
- Follow-up index in `tasks/mainnet-ops-runbook.md` (to be added)
- `memory/working_rule_external_dependencies.md` (no change — this isn't a new working rule, just an instance)
