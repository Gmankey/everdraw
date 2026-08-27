# ADR-0047 - V5 External Audit Contract Remediation

**Status:** Accepted for pre-mainnet remediation
**Date:** 2026-08-27
**Amends:** ADR-0029, ADR-0036
**Responds to:** M-04, M-05, L-01, L-02, L-03, and L-04 in `tasks/v5-external-audit-report-2026-08-26.md`

## Context

The external V5 review found six remaining contract weaknesses that are cheapest to remove before
the immutable mainnet deployment. They affect reward-processing gas, proposal liveness, claim replay
domains, noncanonical ERC-20 behavior, stale Pyth callbacks, and accidental native-MON custody.

## Decision

### Reward schedules are bounded and economically configured

`DrawManagerV5` maintains an active schedule set with O(1) swap-and-pop removal instead of scanning
all historical IDs. At most 16 schedules may be active and one schedule may cover at most 365 draws.
Each allowlisted token has a nonzero owner-configured minimum amount per draw. Funding below that
minimum reverts. Historical schedules remain queryable but stop contributing to draw gas after
cancellation or exhaustion.

### Root fallback starts at seed receipt and is permissioned

The primary proposer retains immediate access after `SeedReceived`. Fallback grace starts when the
current seed is received, not at period end. After grace, only the guardian or an owner-authorized
fallback proposer may propose. This supersedes ADR-0036's permissionless fallback and Q5 assumption.
`startDraw`, finalization, and claims remain permissionless. Authorization changes are emitted and
monitored as privileged configuration.

### Claim leaves use domain version 2

Every leaf commits to `(LEAF_DOMAIN_V2, version, chainId, ClaimManager, distributionId, leafIndex,
account, token, amount)`. Draw algorithm metadata advances to `everdraw-v5-draw-algorithm/2`.
Both independent winner implementations receive chain ID and ClaimManager from verified onchain
input. Roots generated for another chain or ClaimManager cannot be replayed.

### ERC-20 calls are isolated

ClaimManager executes optional-Boolean ERC-20 calls through a self-call boundary. Only empty return
data or an exact 32-byte canonical `true` succeeds. Revert, canonical `false`, malformed length, or
a noncanonical Boolean reverts the isolated frame, rolling back token-side state before the outer
claim records a deferral or fallback.

### Entropy V1 is accepted with fail-soft callbacks

V5 retains Entropy V1 for launch. Wrong-provider callbacks still revert. After provider
authentication, a consumer rejection, including a stale request after rerequest, is caught and
emitted as `RandomnessCallbackIgnored`; it does not revert the Entropy callback. DrawManager also
emits and ignores unknown or inactive request IDs. A current valid callback seeds normally.

### Native MON is accepted only through explicit payable operations

PrizeVault, DrawManager, and ShmonStrategy reject empty-calldata native transfers. Their explicit
payable operations remain unchanged. ClaimManager accepts empty-calldata native escrow only from an
authorized source and emits the receipt; every other raw native transfer reverts. No generic recovery
function may withdraw participant backing, prize escrow, or oracle-fee funds.

## External dependencies and failure behavior

- **Pyth Entropy V1:** stale callbacks are fail-soft; current callback failure remains recoverable
  through the existing timeout and rerequest path.
- **Reward ERC-20s:** allowlisting and minimums bound dust abuse; malformed calls roll back and defer.
- **shMON:** remains the sole V5 payout/share token under ADR-0045.
- **Keeper/watcher:** must consume algorithm v2 and the new leaf domain. JS/Python parity remains a
  mandatory release check.

## Consequences

- Existing UAT roots are incompatible with the new ClaimManager and algorithm version. A fresh UAT
  stack is required after merge; no mainnet V5 stack exists yet.
- Mainnet must configure an independent fallback proposer or explicitly retain the guardian as the
  sole fallback.
- Reward campaigns cannot start until token minimums are configured and tokens are allowlisted.

