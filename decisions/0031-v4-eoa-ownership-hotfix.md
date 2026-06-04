# ADR-0031 — V4 EOA Ownership for Hotfix Deploy; Multisig Deferred to V5

**Status:** Accepted.
**Date:** 2026-06-02
**Parent:** ADR-0024 (V4 contract spec), ADR-0030 (future-proofing inventory).

## Context

V3 is live and missing the Merkl-readable position surface (ADR-0006), so Merkl rewards aren't being indexed. Operator economic incentive to ship V4 immediately. Hotfix tempo: testnet today, mainnet tomorrow.

Original V4 deploy runbook ([tasks/v4-deploy-runbook-2026-06-02.md](../tasks/v4-deploy-runbook-2026-06-02.md) §3, §8) required:

- Owner: operator multisig (with two-step `transferOwnership` + `acceptOwnership`)
- Pauser: separate multisig from owner
- Keeper: Fly EOA

The multisig setup is non-trivial:
- Provisioning a fresh multisig with the right signer set (≥ 3 signers, hardware keys)
- Verifying signer access from each holder
- Testing the `acceptOwnership` flow via the multisig UI before relying on it for mainnet
- Provisioning a *second* multisig for the pauser

That's a day of operator setup, minimum. The hotfix doesn't have that day.

## Decision

For the V4 launch, accept the following:

1. **Owner** is a Ledger-backed EOA controlled by the operator. Address: `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2` (recorded 2026-06-02).
2. **Pauser** is the **same** EOA as owner (collapsing the role separation that ADR-0024 §8 specified).
3. **Keeper** is the existing Fly keeper EOA (no change from runbook).
4. **Deploy mechanism:** builder-controlled throwaway EOA deploys both V4 vaults + oracles, seeds VRF reserve, calls `setKeeper` + `setPauser` + `transferOwnership(0xd399…84A2)`, then is destroyed. Operator calls `acceptOwnership` via MetaMask + Ledger. Final state: Ledger holds owner + pauser, Fly keeper holds keeper, no throwaway key persists.

This is a knowingly weaker security posture than ADR-0024 specified. The trade-off is shipping the Merkl repair tomorrow vs. shipping it in 5–7 days.

**The multisig migration is V5 work.** Tracked in ADR-0030's future-proofing inventory.

## Rationale

- V3 is leaking Merkl reward value daily. Every day of delay is real economic loss.
- The owner-action surface in V4 is small: `setKeeper`, `setPauser`, `setTicketPrice`, `setFeeAllocations`, `setNextRoundMetadata`, `transferOwnership`, `stop`, `pause`/`unpause`, `queueOracleChange`/`commitOracleChange`/`cancelOracleChange`, `setKeeper`, VRF reserve management. None of these can drain user funds directly — `stop()` is the worst case (freezes new rounds; existing claims/withdraws still work).
- A compromised owner EOA is bad but recoverable: operator can deploy V4', migrate users, and rotate keys. Same recovery story as V3's current EOA-owner posture (which the protocol has been operating under for months without incident).
- The "compromised owner can also pause forever" risk that motivated pauser separation is real but bounded: pause doesn't lock funds; claims/withdraws still work even when paused.

## What we accept by doing this

1. **Single-key compromise** rotates the owner to whatever the attacker controls. Attacker can `stop()` the vault (DOS), `pause()` it (DOS), change fee allocations to attacker-controlled addresses, change ticket price, queue an oracle change to a malicious oracle. Attacker cannot drain principal or in-flight prize directly.
2. **Operator key loss** locks the contract permanently with no recovery path. Mitigation: backup the owner key seed in a fireproof location, exercise the recovery routine within 30 days of launch.
3. **No pauser independence**: same key that owns the protocol also pauses it. If the owner key is being compromised in real time, the operator can't pause without revealing the key. Mitigation: `stop()` works as a one-way kill switch from the same key.

## What we don't accept

- Deploying V4 without `stop()` capability — already in the contract.
- Deploying V4 without the VRF callback timeout escape hatch — already in the contract.
- Deploying V4 without `_transferOrDefer` — already in the contract.

In other words, every contract-level safety is in place. The deferred work is operator-side key custody, which is a real but bounded risk.

## Path to V5 multisig migration

V5 will introduce multisig ownership across all live V4 vaults. Migration steps (documented now so we don't lose them):

1. Provision the multisig with the agreed signer set (operator + ≥ 2 independent signers, hardware keys).
2. From the V4 EOA owner: `transferOwnership(multisig)`.
3. From the multisig: `acceptOwnership()`.
4. From the multisig: `setPauser(separateMultisig)` to restore pauser separation.
5. Destroy the V4 EOA owner key.

No contract change needed; the two-step transfer is already in V4. Multisig migration is owner-action-only.

**Target for V5:** within 30 days of V4 launch, conditional on no incident requiring a faster timeline.

## Consequences for the operator

- **Owner key hygiene is critical.** Keep it on hardware (Ledger), backed up offline, never on Fly secrets.
- **Telegram alerts must catch governance events** even more reliably than under multisig (because the multisig had its own UI as a sanity check). Add `OwnershipTransferred`, `PauserSet`, `FeeAllocationsUpdated`, `OracleChangeQueued`, `OracleChanged`, `VaultStopped` as **Critical** severity in keeper-alert-watcher.
- **Schedule the multisig migration on the calendar** within 7 days. Make it visible so it isn't forgotten.

## Consequences for go-live checklist

[`tasks/v4-go-live-checklist-2026-06-02.md`](../tasks/v4-go-live-checklist-2026-06-02.md) Stage 3 (T+30m role rotation) collapses to:

- `setKeeper(FLY_KEEPER, true)`
- `setKeeper(DEPLOYER, false)`

Stop after that. Owner stays as deployer EOA. Pauser stays as deployer EOA (default from constructor). No `transferOwnership`, no `setPauser`, no multisig acceptance.

Stage 9 V3 retirement is unchanged.

A new Stage 10 is added: schedule V5 multisig migration within 30 days.

## Rejected alternatives

- **Wait 5 days to provision a multisig.** Rejected because V3 Merkl bleeding outweighs the marginal security improvement of having a multisig from day 1 instead of day 30.
- **Use a 1-of-1 multisig as a placeholder.** Rejected because that's strictly worse than an EOA (adds attack surface and gas without adding security).
- **Use the Fly keeper EOA as owner.** Rejected because keeper key sits on Fly, which is a much wider attack surface than a hardware-backed operator EOA.

## Open questions

- **Is there an off-the-shelf 1-day-spinup multisig solution that wouldn't require provisioning new signer keys?** Not for V4 launch — operator confirmed punting.
- **Should we add a `setOwnerTimelock` later?** Probably yes for V5. Tracked in ADR-0030 deferred list.
