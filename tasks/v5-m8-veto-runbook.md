# V5 M8 Veto Runbook

**Status:** Draft for operator rehearsal.
**Rule:** the veto drill must be run by the operator personally on testnet.

## Purpose

Prove the guardian/operator can detect and veto a bad V5 root inside the challenge window before any mainnet launch.

## Preconditions

- Watcher is live off-Fly.
- Watcher heartbeat is live through an independent channel.
- Operator is awake and reachable for the full challenge window.
- Bad-root injection method is documented and limited to testnet.

## Drill

1. Start from a healthy completed seed state.
2. Propose a deliberately bad root on testnet.
3. Confirm watcher alarm includes:
   - draw id
   - proposed root
   - recomputed root
   - winner/root diff or enough data to reproduce it
4. Operator independently verifies the mismatch.
5. **Operator-only:** call `vetoRoot(drawId)` from the approved owner/guardian path.
6. Confirm `RootVetoed` event.
7. Propose the corrected root.
8. Confirm watcher reports match.
9. Finalize after the challenge window and claim.

## Evidence

- bad root proposal tx
- watcher alert/log
- veto tx
- corrected root proposal tx
- finalization/claim tx

## Abort Conditions

- Operator cannot access the veto signer.
- Watcher alert is missing, unclear, or delayed beyond SLA.
- Corrected root cannot be reproduced by both implementations.
