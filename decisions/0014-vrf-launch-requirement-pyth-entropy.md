# ADR-0014 — VRF as launch requirement; Pyth Entropy as provider

**Status:** Accepted
**Date:** 2026-05-20
**Deciders:** User + Claude
**Supersedes (in part):** [ADR-0013](0013-randomness-security-model.md) — the $50k prize-cap threshold framing is replaced by "VRF before any public mainnet launch"

## Context

[ADR-0013](0013-randomness-security-model.md) documented the current blockhash-based randomness as economically secure and set an informal $50k weekly-prize threshold above which VRF migration would be required. After reviewing the auditor-acceptance reality and verifying VRF provider availability on Monad mainnet, this framing is incorrect for go-to-market.

The relevant facts:

1. **No external auditor will sign off on validator-manipulable randomness for a public lottery handling real funds**, regardless of current prize size. The finding stays in the report as an open High.
2. **No institutional investor or serious diligence process will accept it.** Crypto Twitter notices these patterns. The first suspicious win destroys reputation permanently.
3. **VRF is live on Monad mainnet today.** Three providers verified deployed:
   - Pyth Entropy: `0xD458261E832415CFd3BAE5E416FdF3230ce6F134`
   - Supra dVRF v3: Router `0x8c009E02C1902126bB88901084B3f0714c6d4304`, Deposit `0xe0d19f368F273e4f4b30490C804097ec6ec7cd4e`
   - Switchboard Randomness: `0xB7F03eee7B9F56347e32cC71DaD65B303D5a0E67`

   Chainlink VRF is **not** on Monad. API3 QRNG and Gelato VRF (mainnet) are not deployed.

4. **Integration effort is ~1 week of focused work**, comparable to or less than the proposed N/J/K commitment hardening scheme — and unlike that scheme, VRF actually closes the audit finding.

## Decision

### Launch requirement

**VRF integration is a launch blocker for any public mainnet deployment of EverDraw.** The blockhash-based randomness in the current contract is acceptable for:

- Local testing
- Internal/testnet rounds
- Closed friends-and-family rounds with explicit consent and total prize value below $1,000

It is **not acceptable** for:

- Any public mainnet announcement
- Any deployment open to retail users
- Any deployment intended to attract external capital or institutional users
- Any audit engagement (the finding will not close)

### Provider selection: Pyth Entropy

**Pyth Entropy is the selected provider.** Reasons:

1. Purpose-built for lottery / coin-flip / random-selection use cases. Their documentation and reference implementations directly match EverDraw's draw pattern.
2. Largest install base across EVM chains; most mature SDKs and integration tooling.
3. Cleanest interface: a single `requestWithCallback` + a single `entropyCallback` function on the consumer side.
4. Per-request fee is negligible against weekly prize size (~fractions of a cent).
5. Documented failure semantics — if the primary provider doesn't reveal, a fallback path exists.

Supra dVRF and Switchboard remain viable secondary options if Pyth's SLA or pricing becomes unacceptable. They are not selected now because there is no reason to take on a more complex integration without a forcing event.

### What goes away when VRF lands

The following exist solely to mitigate the blockhash-randomness problem, and become dead code once VRF is in:

- `MAX_RECOMMITS_PER_ROUND` constant and `recommitCount` field on `RoundData`
- `recommit(uint256 rid)` external function
- `_recommit(uint256 rid)` internal function
- `NextAction.Recommit` enum value
- `r.targetBlockNumber` field on `RoundData`
- All `blockhash` / `block.prevrandao` references in `_drawWinner`

The 6-day lock period stays — its purpose per [ADR-0002](0002-lock-period-and-draw-timing.md) is yield accrual, not randomness windowing. That purpose is unaffected by switching to VRF.

### What replaces it

The randomness flow becomes asynchronous:

```
Open → AwaitingVRF → Drawn → Settled
           │            │
           │            └── permissionless finalize tx
           │                selects winner, computes prizeShares
           │                NO requestUnstake — shMON shares returned directly
           │
           └── Pyth Entropy provider calls back with random number
```

**No `Finalizing` state and no shMON unstake in V3.** The V3 design follows the same no-unstake philosophy as the V2 production contract:

- At settlement, the winner receives yield shMON shares (ERC-20 transfer via `shmon.transfer`)
- Every depositor recovers their principal as shMON shares (ERC-20 transfer via `shmon.transfer`)
- Users who want MON are redirected to shmonad.xyz to unstake their own shares

The `_commitDraw` function submits a Pyth VRF request and transitions the round to `AwaitingVRF`.

The Pyth callback function (`entropyCallback`) is kept deliberately lean — it only stores the random number and updates state. The heavy work (winner derivation, prize computation) happens in a separate permissionless `finalizeDraw(rid)` function that anyone can call once state is `Drawn`. This is critical because Pyth's callback has a gas budget.

Prize computation (exchange-rate model, ADR-0004): shMON is a non-rebasing ERC-4626 vault — share count is constant but each share is worth progressively more MON as staking yield accrues. At `finalizeDraw` time:

```
principalSharesAtSettle = shmon.previewDeposit(totalPrincipalMON)  // fair-value shares at current rate
prizeShares             = totalPrincipalShmonShares - principalSharesAtSettle
```

Users deposited shares at a lower rate; by settlement each share is worth more MON. `previewDeposit(depositedMON)` returns **fewer** shares (same MON value). The surplus shares — representing the yield generated during the lock period — are the winner's prize. Depositors get back slightly fewer shares than they deposited, but their MON value is unchanged.

`totalUnclaimedShares` tracks the total shares the contract owes across all open rounds. It is incremented at deposit and decremented at `withdrawPrincipal` / `claimPrize`. It is **not** incremented at `finalizeDraw` in the exchange-rate model (prize shares are a redistribution within already-tracked deposits, not new shares).

## Why not the N/J/K commitment scheme

A multi-block commit/reveal scheme using blockhashes was proposed as an interim hardening. It was rejected for the following reasons:

1. **Introduces a new grinding surface.** The validator who produces block `N+J` gets active influence over which validator produces the final target block — a grinding power no validator has in the current single-target-block design. Strictly worse for one important attack vector.
2. **Does not close the audit finding.** Auditors evaluate randomness against the bar of cryptographic verifiability, not "harder to attack." Both current and N/J/K designs fail that bar.
3. **Reveal-withholding is unmitigable cheaply.** Slashing a keeper for failed reveal requires distinguishing malicious withholding from network failure — impossible on-chain. Bond sizing is unsolvable: smaller than prize → attack profitable, larger than prize → no rational keeper.
4. **Integration effort comparable to VRF.** N/J/K requires careful state-machine changes, keeper-bonding design, retry-cap handling, and significant new test surface. For roughly the same engineering cost, VRF actually solves the problem.

The N/J/K scheme is not pursued. ADR-0013's threat-model framing stands as historical context but is superseded by this ADR for launch posture.

## Rationale

- The "we'll add VRF when prizes get bigger" stance is a deferred-cost trap. It looks cheap now and becomes a forced migration under reputation pressure later, by which time the protocol has accumulated TVL, integrations, and user expectations that make migration harder.
- VRF is available **now** on Monad. There is no good engineering reason to ship blockhash-based randomness when a working VRF provider exists on the target chain.
- The auditor's report is a load-bearing artifact for go-to-market. Closing the randomness finding moves the report from "publicly defensible with caveats" to "publicly defensible."

## Alternatives considered

- **Ship current design unchanged with $50k prize-cap governance trigger (ADR-0013 stance):** Rejected. Auditor finding stays open; market acceptance assumption is wrong.
- **N/J/K multi-block commitment scheme:** Rejected. See above — adds grinding surface, doesn't close audit finding.
- **Supra dVRF v3:** Viable. Not selected because Pyth has a cleaner integration path and larger ecosystem. Held as fallback.
- **Switchboard Randomness:** Viable. Two-step `createRandomness` → `settleRandomness` → `getRandomness` interface is more unusual; higher integration cost. Held as fallback.
- **Wait for Chainlink VRF on Monad:** Rejected. No public timeline. Pyth is live now.
- **Build a custom VRF using a trusted committee or oracle network:** Rejected. Outside engineering scope and reinvents the wheel.

## Consequences

### Contract

- One new external contract dependency (`IEntropy` at `0xD458261E832415CFd3BAE5E416FdF3230ce6F134`) and one new role (Pyth's randomness provider).
- Contract gains a `payable` surface on `_drawWinner` (or wraps it in a function that forwards the Pyth fee).
- Removal of ~50 lines of recommit/blockhash machinery.
- Net contract complexity roughly neutral.

### Keeper

- Round progression now has an asynchronous gap (seconds to minutes) between `_drawWinner` and `finalizeDraw`. Keeper must either (a) submit both and the second is permissionless if keeper is slow, or (b) trust the Pyth provider to drive the callback and only submit `finalizeDraw`.
- Slightly increased operational complexity but offset by removing the recommit retry path entirely.

### Frontend

- Round state UI gains an intermediate "Drawing winner..." state corresponding to `AwaitingVRF`. This is fine — users see it briefly during the once-per-week settle event.

### Audit

- The current open High finding on `weak-prng` closes.
- A new (informational) finding may appear on "VRF provider trust" but is treated as acceptable trust delegation in the same way Pyth price feeds are.

### Economic

- Per-draw Pyth fee. Pyth charges a small native-token fee per `requestWithCallback`. Funded from the round's MON balance before unstake or from a small protocol reserve. Negligible against prize size at any reasonable TVL.

### Migration

- This requires a **new contract deployment**. The current V2Compat contract has no proxy and cannot be upgraded in place.
- Existing rounds (if any) settle on the current contract; no new rounds open after the new contract is live.
- Frontend points at the new contract address from the cutover moment.

## Open questions

- Exact Pyth fee on Monad mainnet at deploy time. Read live from `IEntropy.getFee(provider)` rather than hard-coded.
- Whether to use the default Pyth-operated provider or run a self-hosted provider. Default provider is the right choice unless we have a specific reason to operate our own (we don't).

## Related ADRs

- [ADR-0002 — Lock-period semantics and draw timing](0002-lock-period-and-draw-timing.md) (lock duration unchanged; randomness windowing concept retired)
- [ADR-0013 — Randomness security model](0013-randomness-security-model.md) (superseded for launch posture)
- ADR-0015 (future) — VRF provider failover playbook (deferred until needed)
