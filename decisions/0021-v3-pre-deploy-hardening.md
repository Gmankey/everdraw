# ADR-0021: V3 Pre-Deploy Hardening

**Status:** Accepted  
**Date:** 2026-05-26  
**Deciders:** Owner

---

## Context

`TicketPrizePoolShmonV3` deploys to mainnet on Wed 2026-05-27 13:00 UTC (Vault A — completed 2026-05-27 13:25 UTC at `0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee`) and Sun 2026-05-31 01:00 UTC (Vault B — scheduled). The contract is non-upgradeable — once deployed, storage layout, event signatures, function selectors, and immutables are locked forever.

Two categories of risk identified pre-deploy:

1. **External dependency lock-in** — Pyth's Entropy contract and provider addresses are hardcoded as `immutable`. If Pyth deprecates the contract or rotates the provider (both have happened on other chains), the vault becomes inoperable. Only fix is full redeployment, losing round history.
2. **Vision misalignment** — Phase 3-4 of the roadmap (multi-asset vaults, cross-protocol mega draws, campaign manager, points layer) require per-round metadata for sponsor attribution, round categories, and external pointers. The current `RoundData` struct has no slot for any of this.

Both issues are impossible to fix after deploy. Both must be addressed in the same PR before Wednesday.

A third category (event indexing, version constant, ownership trail standardization) is hardening: cheap to add now, irreversibly missing if not. Covered in the same builder ticket but not requiring an ADR — these are observability fixes, not design decisions.

---

## Decision

### 1. Make `entropy` and `entropyProvider` owner-settable with a 24-hour timelock

Replace the `immutable` keyword on both fields. Add a two-step change flow:

- `queueEntropyChange(newEntropy, newProvider)` — owner-only. Stores the proposal and a `pendingEntropyEffectiveAt = block.timestamp + ENTROPY_CHANGE_DELAY`. Emits `EntropyChangeQueued`.
- `commitEntropyChange()` — owner-only. Reverts unless `block.timestamp >= pendingEntropyEffectiveAt`. Applies the change. Emits `EntropyChanged`.
- `cancelEntropyChange()` — owner-only. Wipes the pending change. Emits `EntropyChangeCancelled`.

`ENTROPY_CHANGE_DELAY` is a public `constant` of `24 hours`.

#### Why the timelock

Without it, a malicious owner could swap to a provider they control immediately before `commitDraw` and steer the winning ticket. The timelock breaks this attack:

- The queue event is public and indexable. Watchers, the frontend, and Telegram alerts can flag it.
- Users have 24 hours to withdraw principal from already-settled rounds and avoid buying tickets in any round that opens during the queue window.
- By the time the swap commits, depositor exit makes any remaining attack uneconomical.

#### Why not just keep it immutable

Probability of a Pyth migration in the contract's lifetime is non-zero. The cost of mitigation is small (two functions, ~100 lines). The cost of being wrong is total vault redeployment.

### 2. Add two per-round metadata fields

Append to `RoundData`:

```solidity
address campaign;     // CampaignManager or sponsor address; address(0) = no campaign
bytes32 metadata;     // Opaque payload — encoding defined by campaign or off-chain
```

Snapshotted at round open from owner-settable storage (`nextRoundCampaign`, `nextRoundMetadata`), identical pattern to the protocol fee snapshot from ADR-0020. Setter is `setNextRoundMetadata(address, bytes32)` (`onlyOwner`).

#### Why two fields, not one

- `campaign` typed as `address` so block explorers, the indexer, and the future CampaignManager can join by address directly. Phase 3 cross-protocol mega draws and Phase 4 branded partner vaults both require sponsor attribution; an address field makes this a single indexed query.
- `bytes32 metadata` for everything else — category byte, points multiplier, IPFS pointer for round-specific artwork or promo terms. Stays flexible so we don't have to predict every Phase 3-4 feature now.

Two fields is enough. Past that, anything can be either encoded into `metadata` or stored externally in CampaignManager keyed by `(campaign, roundId)`.

#### Why not put them in CampaignManager only

CampaignManager doesn't exist yet (Phase 2). The V3 vault is deploying Wednesday. If we wait for CampaignManager and add the fields later, we can't — the contract is immutable. So we add the slots now, leave them as `(address(0), 0x0)` for plain MON rounds, and let CampaignManager populate them when it ships.

---

## Scope

Applies to **V3 only** (`TicketPrizePoolShmonV3`). V2 vaults remain unchanged.

Indexer requires a coordinated ABI update because two existing V3 event signatures change topic hash (`VRFRequested` and `VRFFulfilled` gain an indexed `sequence`). The indexer is deployed but only watches V2 vaults today — the V3 ABI update lands before any V3 vault is deployed, so no live data is at risk.

Frontend changes (displaying `campaign`/`metadata` per round, banner for pending entropy changes) are out of scope here — separate follow-up tickets after the V3 contract is live.

---

## Consequences

- Owner gains the ability to swap the VRF source. Documented as an explicit trust assumption alongside existing ones (pause, fee, VRF reserve withdrawal).
- Off-chain watchers must monitor `EntropyChangeQueued` and surface it to users and ops.
- Round records now carry two extra storage slots — ~40k gas per round in additional writes. Negligible operationally.
- CampaignManager (Phase 2-3 work) has the on-chain slots it needs from day one.
- Auditors must review: timelock cannot be bypassed; pending changes can be cancelled; metadata fields cannot be mutated after round open.

---

## Rejected alternatives

**Keep entropy/provider immutable, accept Pyth migration as a redeploy event** — rejected. Loses round history at every redeploy. Forces vault-address rotation, which breaks indexer continuity, points history, and any third-party integration that hardcoded the vault address.

**Allow entropy change without timelock** — rejected. Enables a chosen-winner attack as described above.

**One generic `bytes32` metadata field instead of two** — rejected. Address-typed `campaign` enables cheap indexer joins; encoding an address into a `bytes32` payload pushes that decoding cost onto every reader forever.

**Add five reserved fields "just in case"** — rejected. Two fields with one being intentionally opaque covers everything Phase 3-4 needs; more is hoarding storage.

**Defer to a V3.1 contract after launch** — rejected. The fields and entropy mutability are needed in the contract that holds depositor funds; a "V3.1 with the fixes" is just a V3 redeploy with all the same cost.
