# V5 keeper legacy-claim retry and alert-noise builder ticket

**Priority:** Low for funds, high for operability; launch blocker #6
**Related decisions:** ADR-0022, ADR-0036, ADR-0043, ADR-0045
**Scope:** `scripts/keeper-v5.js`, managed V5 keeper alerting, tests, and UAT verification

## Problem

The UAT keeper retries a permanently invalid legacy claim on every loop. Draw 45 returns
`ClaimManagerV5.InvalidProof()` (`0x09bde339`) because the candidate belongs to a prior stack.
PRs #236/#237 made the failure non-fatal, but every isolated failure still sends a Healthchecks.io
`/fail` ping. Explicit failure pings ignore the check's Period and Grace, so the check flaps
DOWN to UP and floods Telegram while later draw lifecycle work continues normally.

`V5_KEEPER_FROM_BLOCK` only bounds event reconstruction. It does not bound the draw-ID claim
loop. With `KEEPER_RECENT_CLAIM_WINDOW=1000`, draw 45 remains in the candidate set while the
current draw ID is 105.

## Required behavior

1. Persist terminal claim quarantine state across keeper loops and Fly restarts.
2. Treat `InvalidProof`, `DistributionNotFound`, `AlreadyClaimed`, and `BadLeaf` as terminal.
3. Exclude quarantined claims before proof reconstruction and transaction submission.
4. Continue retrying transient RPC, timeout, nonce, and funding errors.
5. Do not send the dead-man `/fail` signal for an isolated terminal claim.
6. Send one operator notification for each newly quarantined claim and include the quarantine
   count in normal keeper heartbeat output.
7. Reserve failure signaling for blocked lifecycle progress, balance below floor, unreachable RPC,
   crash loops, or transient claim failures that reach the configured threshold.
8. Check whether the distribution exists in the configured ClaimManager before reconstructing
   proofs, so cross-stack distributions can be rejected cheaply at source.
9. Keep claim state on the existing `/data` Fly volume.

## External dependencies and failure handling

- **Monad RPC:** transient read/write failures remain retryable; repeated failures reach the normal
  keeper failure path.
- **ClaimManagerV5:** terminal custom errors are quarantined; other reverts remain retryable.
- **Fly volume:** claim state is atomically replaced. An unreadable or unsupported state file fails
  startup rather than silently forgetting quarantines.
- **Telegram:** receives a one-time quarantine notification. Delivery failure does not stop keeper
  lifecycle work.
- **Healthchecks.io:** receives successful loop heartbeats with a quarantine count. Terminal claims
  do not send `/fail`; real keeper failures still do.

## Acceptance

- Unit tests cover all four terminal selectors, nested ethers error data, transient retries,
  persistence across restart, one-time quarantine, and alert routing.
- A regression test records why draw 45 remains eligible under a 1000-draw claim window.
- Managed keeper configuration points claim state at `/data`.
- On UAT after merge: restore the dead-man URL, deploy the keeper, verify normal operation stays
  green, verify one terminal quarantine does not send `/fail`, and verify a genuine stopped
  keeper turns the check red.
- The real soak must include live deposits and yield; skipped draws alone do not prove claims.
