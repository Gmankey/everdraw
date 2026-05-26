# ADR-0011 — Vault B contract replacement (May 2026)

**Status:** Accepted
**Date:** 2026-05-20
**Deciders:** User + Claude (PM)

## Context

ADR-0010 codifies that both contracts filling the UI "Vault A" and "Vault B" roles must share identical cadence parameters. The contract currently filling the Vault B role does not comply.

### Current state of the Vault B role

The Vault B role has been filled by two different contracts in sequence:

1. **Original Vault B** — `0x1B20BAa2D3992834E1E75cf75e3cD7b6AAA38096`. Retired in the Vault B incident of 2026-05-17 (see context below). Was a V2Compat contract with the old shMON unstake/finalize flow, not the no-unstake V2 design. Cleanly retired: round 1 settled, lone depositor (PM test wallet) claimed prize and principal, removed from keeper and frontend.

2. **Current Vault B** — `0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a`. After the original Vault B was retired, this contract (which had been an earlier-generation Vault A pre-ADR-0003 migration, still on-chain) was promoted into the Vault B role to keep two vaults visible in the UI. It runs the correct no-unstake V2 contract code, but its constructor args are wrong:
   - `yieldPeriodSec = 604800` (7d) — should be `518100` per ADR-0010
   - Anchor mismatch: round opens drift by ~1 day per cycle relative to a true Sun anchor.
   - Effective cycle is ~8 days, not the 7 days required for the 3.5d offset with Vault A.

Vault A (`0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888`) is compliant.

### The Vault B incident (2026-05-17, for record)

The original Vault B (`0x1B20BAa2…`) was deployed with V2Compat code (still uses shMON `requestUnstake` / `completeUnstake` and the Finalizing state) instead of the no-unstake V2. After its first round committed and drew a winner, the round entered Finalizing state waiting for shMON epoch 775. The keeper had been configured to treat it as a current V2 pool and quarantined it on the unexpected `Settle` (action=4). Misdiagnosis labelled action=4 as "old-contract action shape"; on investigation, action=4 is a valid V2Compat Settle, the contract was simply waiting for the shMON unstake epoch.

Resolution: keeper config split (legacy pool path for V2Compat-style settlement), contract paused to stop further deposits, frontend updated to remove the contract from the active rotation. shMON epoch reached → settle stuck → discovered that `pause()` also blocks `executeNext()` (the `whenNotPaused` modifier covers settlement too) → unpaused → keeper settled → lone depositor (PM wallet) claimed via direct contract calls (`claimPrize(1)` then `withdrawPrincipal(1)`). Contract is now empty and fully retired.

Lessons captured for runbook:
- `pause()` blocks settlement, not just deposits. Pause-then-retire must be sequenced as **let-settle → claim → remove from keeper**, not pause first.
- Action enum semantics differ between V2Compat and V2 — `isV2` keeper flag must match the actual deployed code, not the intended generation.
- The fact that this contract was deployed with V2Compat code at all is the upstream defect — see ADR-0010 process fix (deploy from ADR, not from prior contract).

### Why this needs fixing now

Until the Vault B role is filled by a contract that complies with ADR-0010, the product promise of "two vaults on a 3.5-day stagger" is broken. Marketing/Merkl campaigns and the public docs will be saying one thing while users observe another. Fixing it before any external incentive campaign launches (e.g. Merkl) is non-negotiable.

## Decision

Deploy a **replacement Vault B contract** with cadence-compliant constructor args, switch the Vault B UI role over to it after the current `0xed67…` round 4 settles cleanly, and retire `0xed67…` from the keeper.

### Deploy parameters (per ADR-0010)

| Param | Value |
|---|---|
| `shmon` | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` |
| `ticketPriceMON` | `1000000000000000000` (1 MON) |
| `roundDurationSec` | `86400` |
| `yieldPeriodSec` | `518100` |
| `owner` | `0x84875804608467B3577605c0976dC645739091eD` (user personal wallet — same as Vault A pre-existing owner, see open question below) |
| Contract source | Current no-unstake V2 (`TicketPrizePoolShmonV2`) |

### Deploy timing

**Sun 2026-05-24 01:00 UTC.** This is exactly 3.5 days (84h) after Vault A's Wed 13:00 UTC anchor. From this anchor, Vault B's permanent weekly slot is Sun 01:00 UTC. ADR-0001's earlier Sun 13:42 UTC anchor is superseded by this one.

### Sequencing (must be in this order)

1. **Pre-deploy verification (≥24h before deploy):** confirm Vault A is healthy, confirm the V2 contract source in `src/` matches the bytecode of Vault A (`0x2208…`), confirm builder ticket cites both this ADR and ADR-0010.
2. **Deploy at the anchor** — Sun 2026-05-24 01:00 UTC. First round opens immediately at deploy.
3. **Post-deploy verification (mandatory, blocks promotion):** side-by-side `cast call` of `roundDurationSec`, `yieldPeriodSec`, `ticketPriceMON`, `shmon`, and `owner` on both Vault A and the new contract. All must match the ADR-0010 table.
4. **Register new contract** with the keeper EOA via `setKeeper(0x80dE…, true)`.
5. **Promote into Vault B UI role:**
   - Frontend: replace `0xed67…` with the new address in `VITE_POOL_ADDRESSES_V2`, redeploy.
   - Keeper: replace `0xed67…` with the new address in `POOL_ADDRESSES` and `POOL_ADDRESSES_V2` in `~/.config/everdraw/keeper-mainnet.env`. **Do not remove `0xed67…` yet** — see step 6.
   - `POOL_SCHEDULE_V2`: remove retired `0x1B20…`, add new vault, retain `0x2208…`. (Both anchors only, no `0xed67…`.)
6. **Keep `0xed67…` in retire-only monitoring** (in `POOL_ADDRESSES` only, not `POOL_ADDRESSES_V2`, not displayed in frontend) so the keeper can settle the in-flight round 4 (~2026-05-25 13:25 UTC) and any post-settle claim/withdraw is reachable on-chain even if not via the UI.
7. **Block new rounds on `0xed67…` at commit time, not after settle.** Source review of the V2 contract (the code `0xed67…` runs) confirms:
   - `commit(rid)` opens the next round if `rid == currentRoundId`. So `commit(4)` will advance `currentRoundId` to 5.
   - `settle(rid)` has an `_startNextRound()` guard, but because `commit(4)` has already incremented `currentRoundId`, `settle(4)` does **not** open another round.
   - Per source review, `commit()` and `settle()` do **not** carry the `whenNotPaused` modifier (unlike the V2Compat contract from the original Vault B incident). Pause therefore blocks `buyTickets()` but not the settlement path. Builder to dry-run-verify against the live deployed bytecode before deploy day — belt and braces.

   Therefore the sequence is:
   - Allow `commit(4)` to fire at the commit-eligible time (~2026-05-25 13:25 UTC).
   - **Immediately** call `pause()` from owner key (`0x84875804608467B3577605c0976dC645739091eD`) after `commit(4)` mines, before any deposit can land in round 5. Round 5 will exist on-chain but be locked.
   - Allow `settle(4)` to fire shortly after (it does not require unpaused state).
   - This is the inverse of the Vault B incident lesson: with V2 (no `whenNotPaused` on settle path) we *can* pause-then-settle. With V2Compat we could not. Contract-specific, not universal.

8. **After all `0xed67…` round 4 depositors have claimed** (PM verifies via on-chain `principalMON` sweeps): remove `0xed67…` from `POOL_ADDRESSES` entirely, restart keeper watchdog.

### What users see across the transition

- **Before Sun 2026-05-24 01:00 UTC:** UI shows Vault A (`0x2208…`) and Vault B (`0xed67…`) as today.
- **At Sun 2026-05-24 01:00 UTC:** UI Vault B switches to the new contract. New Vault B round 1 opens at this moment. No "Vault C" or new vault name appears anywhere — it's still "Vault B."
- **`0xed67…` depositors** (currently 1 ticket / 1 MON in round 4): the existing position is reachable through the user's "My Rounds" view across UI, which fetches positions by wallet across all known pools regardless of whether the pool is in the active rotation. They claim through the same UI they always have. *Frontend builder must verify this is true before deploy day.*

## Rationale

- `yieldPeriodSec` is immutable. Redeploy is the only path to compliance with ADR-0010.
- Allowing `0xed67…` to settle naturally and `setKeeper(false)` rather than `pause()` avoids reproducing the Vault B settlement-deadlock incident.
- A 3.5d offset means the new Sun anchor must be calculated from Vault A's Wed anchor + 84h. Sun 01:00 UTC is the cleanest aligned slot.
- Sequencing the keeper config update before the UI promotion means the keeper can pick up the new contract's first round opening within seconds of deploy.

## Alternatives considered

- **Live with the 8-day cycle on Vault B.** Rejected — breaks the user-facing product promise of a predictable weekly cadence and the stagger math. Also breaks any time-based incentive campaign budgeted on a 7-day basis.
- **Migrate `0xed67…` round 4 funds to the new vault.** Rejected — there is no on-chain migration primitive, and the depositor (PM) can claim normally after settle. Not worth contract complexity.
- **Take Vault B offline entirely for 7 days while we redeploy.** Rejected — leaves only Vault A active, defeats the staggered cadence for a week and confuses users. Hot replacement is cleaner.
- **Deploy at a different anchor than Sun 01:00 UTC** (e.g. matching the original Sun 13:42 anchor exactly). Rejected — Sun 01:00 UTC is a cleaner public-facing slot and the original 13:42 had no special meaning beyond happening to be when the first deploy went through.

## Consequences

### Builder ticket items
1. Deploy `TicketPrizePoolShmonV2` at Sun 2026-05-24 01:00 UTC with exact params from ADR-0010 table.
2. Run post-deploy verification script and attach output to ticket close-out.
3. Update `~/.config/everdraw/keeper-mainnet.env` (`POOL_ADDRESSES`, `POOL_ADDRESSES_V2`, `POOL_SCHEDULE_V2`) per the sequencing section.
4. Update Vercel env vars (`VITE_POOL_ADDRESSES_V2` in `everdraw` project) — note this is a manual user step in Vercel dashboard, builder cannot do it directly.
5. Restart keeper watchdog after env update.
6. Frontend verification: confirm `0xed67…` depositors can still see and claim positions via "My Rounds" view post-promotion.

### Owner-key topology (verified 2026-05-20)
- Vault A (`0x2208…`) owner: `0x84875804608467B3577605c0976dC645739091eD` (user personal wallet). ✅ Compliant.
- Retiring Vault B (`0xed67…`) owner: same. ✅ Consistent.
- Retired Vault B (`0x1B20…`) owner: keeper EOA `0x80dE4674dEFC68F06F4772B8Ec2F89aBda43DBE9` — the anomaly was confined to the retired contract; the live cadence pair is consistent.
- New Vault B owner: same personal wallet, per the deploy params table above.

### Risk
- New Vault B's first round (Sun 2026-05-24 → settle ~Sun 2026-05-31) will be the **first production V2 commit→settle on mainnet for a Vault B-role contract**. (Vault A's first commit→settle is in flight at time of writing, see release-readiness checklist.) Monitor closely.
- The original Vault B incident showed that "intended" vs "deployed" contract semantics can diverge silently. The post-deploy verification step exists to catch this.

### External integrations
- **Merkl campaign:** do not submit the Vault B address to Merkl until *after* the new contract deploys and is verified compliant. Submit both Vault A and the new Vault B together post-2026-05-24. See PM discussion 2026-05-20.

## Root cause (added 2026-05-20)

`0xed67…` was deployed with `yieldPeriodSec = 604800` because the deploy script picked a constructor arg from prior/default deploy memory instead of from the accepted cadence intent in ADR-0001. No ADR pinned the exact value at the time, so there was nothing for the script (or the human reviewing it) to disagree with.

**Process fix going forward (also referenced in ADR-0010):**
- Deploy scripts for any contract that fills a Vault A or Vault B role read constructor args from the ADR-0010 parameter table, not from prior contract state or builder shorthand.
- The deploy ticket cites ADR-0010 explicitly.
- Post-deploy verification compares all five params side-by-side against ADR-0010 and against the other active vault. Mismatch blocks promotion into the UI role.

## Related ADRs

- ADR-0001 — Two-vault staggered deposit cadence (Vault B anchor updated by this ADR)
- ADR-0003 — Migration of current Vault A and Vault B deployment (the original two-vault deploy)
- ADR-0010 — Cadence invariant for Vault A and Vault B contracts (the rule this ADR enforces)
