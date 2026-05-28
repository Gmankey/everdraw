# Smart Contract Security Audit — TicketPrizePoolShmonV3

**Contract:** `TicketPrizePoolShmonV3` (`src/TicketPrizePoolShmonV3.sol`)
**Source revision:** `186f1ad` (staging HEAD, 2026-05-28)
**Deployed instances at time of audit:**
- Vault A V3 — `0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee` (Monad mainnet, deployed 2026-05-27 13:25 UTC)
- Vault B V3 — scheduled for 2026-05-31 01:00 UTC (same source)

**Auditor:** Claude (Sonnet 4.6) — internal security review
**Date:** 2026-05-28
**Scope:** Single contract file (1010 lines), plus cross-reference against ADRs 0010, 0012–0015, 0019–0022
**Methodology:** Manual line-by-line review, control-flow tracing, trust-boundary analysis, ADR-vs-implementation cross-check

---

## 1. Executive Summary

`TicketPrizePoolShmonV3` is a non-upgradeable no-loss lottery contract that uses Pyth Entropy for verifiable randomness. It accepts MON deposits, stakes them into the shMON ERC-4626 vault for yield, and at settlement awards the accumulated yield to a randomly-selected winner while every depositor recovers their fair-value principal in shMON shares.

**Bottom line: No HIGH-severity vulnerabilities found. No MEDIUM-severity vulnerabilities found at confidence ≥ 8/10.**

The contract is the product of multiple prior hardening passes (documented in ADRs 0012, 0013, 0014, 0015, 0020, 0021). Each documented owner privilege is enforced in code with the appropriate guard. Reentrancy protection is consistent across user-facing state-changers. The CEI pattern is followed for all external calls into the trusted shMON vault. The Pyth Entropy integration is implemented per Pyth's `IEntropyConsumer` reference pattern. The fee-snapshot mechanism (ADR-0020) prevents retroactive fee changes against players already committed to a round. The 24h entropy-timelock (ADR-0021) prevents instant VRF-source swaps from being used to manipulate an in-flight draw.

Five observations below confidence-8 are recorded for the operator's awareness in §6. None block the planned Vault B V3 deployment.

The contract carries the trust assumptions documented in ADR-0022 (single-signer owner with documented privileges, trusted shMON token, trusted Pyth provider). Within those documented assumptions, the contract behaves correctly.

---

## 2. Audit Scope and Boundaries

### In scope

- `src/TicketPrizePoolShmonV3.sol` at the audited commit
- Compiler config: solc 0.8.33, optimizer 200 runs, viaIR, evmVersion paris (from `deployments/monad-mainnet.json`)
- Constructor inputs and immutable config as deployed on Monad mainnet
- The Pyth Entropy SDK interface contracts (`IEntropy`, `IEntropyConsumer`) as imported

### Out of scope

- The shMON token contract (treated as trusted external dependency per ADR-0004; assumed to be a standard ERC-4626 vault with no reentrancy callbacks, no transfer-recipient blacklist, no fee-on-transfer behavior)
- The Pyth Entropy contract and the configured entropy provider (treated as trusted oracle; the contract validates `provider == entropyProvider` in the callback path, and the 24h timelock on entropy-config changes gives users an exit window before any swap takes effect)
- The keeper bot off-chain implementation (not in this repo)
- The frontend (`web/src/App.jsx`)
- The indexer (`scripts/indexer/`)
- V2 vaults — separately audited; not re-reviewed here
- Operational security of private keys, RPC endpoints, hosting infrastructure (see ADR-0022 for the operational trust model)

### Audit assumptions

1. The shMON vault correctly implements ERC-20 `transfer` (returns true on success, does not revert spuriously for valid recipients)
2. The shMON vault correctly implements ERC-4626 `deposit` and `previewDeposit`
3. Pyth Entropy delivers the callback `entropyCallback(sequence, provider, randomNumber)` exactly once per fulfilled request, signed by the configured `entropyProvider`
4. The Monad chain provides standard EVM semantics for `block.timestamp`, `block.prevrandao`, and revert-on-overflow under Solidity 0.8.x
5. Off-chain governance (the single owner EOA) acts in good faith under the documented trust model in ADR-0022

Any assumption above being false would invalidate the corresponding portion of this audit.

---

## 3. Methodology

The review proceeded in four passes:

1. **Architecture pass.** Read the contract end-to-end without judgment. Mapped the round lifecycle (`Open → AwaitingVRF → Drawn → Settled` plus `Open → Settled` skip path). Identified the external surfaces: user-facing (`buyTickets*`, `claimPrize`, `withdrawPrincipal`), keeper-facing (`executeNext`, `commitDraw`, `skipRound`, `finalizeDraw`), and owner-facing (12 functions including the entropy timelock triplet). Identified the external dependencies: shMON token, Pyth Entropy contract, Pyth entropy provider.

2. **Trust-boundary pass.** For each function with a guard (`onlyOwner`, `nonReentrant`, `whenNotPaused`), traced the boundary. For each external call, verified the call site against the CEI pattern. Identified all state writes and grouped them by the function paths that touch them.

3. **ADR cross-check.** Loaded each of ADRs 0010, 0012–0015, 0019–0022. For each commitment in the ADR (e.g. "fee capped at 20%", "entropy timelock 24 hours", "snapshot fee at round-open"), located the corresponding code and verified the implementation matches the specification.

4. **Adversarial pass.** Enumerated attacker capabilities: (a) any external EOA, (b) a malicious depositor, (c) a malicious keeper hot-wallet holder, (d) the owner under a compromised key, (e) the Pyth provider going hostile, (f) the shMON token going hostile. For each, traced the worst case and verified the contract's resistance falls within the documented trust model.

Each potential issue was assigned a confidence score (1–10). Per the false-positive-filtering rules, only findings at confidence ≥ 8 are reported as audit findings. Findings below that threshold are recorded as informational notes in §6.

---

## 4. Findings Summary

| # | Severity | Confidence | Title |
|---|----------|------------|-------|
| — | — | — | **No HIGH or MEDIUM findings at confidence ≥ 8.** |

Five informational observations follow in §6.

---

## 5. Detailed Verification

### 5.1 Reentrancy

| Function | Guard | CEI pattern | External calls | Result |
|----------|-------|-------------|----------------|--------|
| `_buyTicketsMON` (line 493) | `nonReentrant`, `whenNotPaused` | `principalMON` and `r.totalPrincipalMON` written before `shmon.deposit` (line 509). Per-user shares mapping and `totalUnclaimedShares` written immediately after the deposit using the return value, but guarded by `nonReentrant` against any callback path. | `shmon.deposit{value: cost}` (trusted external) | Clean |
| `claimPrize` (line 832) | `nonReentrant` | `r.prizeClaimed = true` and `totalUnclaimedShares -= shares` written before `shmon.transfer` (lines 838, 844, 845) | `shmon.transfer` (trusted ERC-20, no callback) | Clean |
| `withdrawPrincipal` (line 863) | `nonReentrant` | `principalMON[rid][user] = 0`, `principalShmonShares[rid][user] = 0`, `totalUnclaimedShares -= sharesToReturn` written before `shmon.transfer` (lines 880–883) | `shmon.transfer` (trusted ERC-20, no callback) | Clean |
| `_finalizeDraw` / `finalizeDraw` (line 664) | `nonReentrant` on the external entry point | Round state updated to `Settled` and `totalUnclaimedShares -= feeShares` written before fee `shmon.transfer` (lines 715–717). Reentrant `_finalizeDraw` blocked by `nonReentrant`. | `shmon.transfer` (trusted ERC-20, no callback) | Clean |
| `withdrawVRFReserve` (line 442) | `nonReentrant`, `onlyOwner` | No reentrant surface (owner-only) | `msg.sender.call{value: amount}` | Clean |
| `_commitDraw` (line 624) | None on the wrapper functions (`commitDraw` at line 802 and `executeNext` at lines 541, 549 are permissionless and lack `nonReentrant`) | `r.state = RoundState.AwaitingVRF` and `r.vrfRequestTime` written before `entropy.requestWithCallback` (lines 644–647). | `entropy.requestWithCallback{value: fee}` (trusted Pyth contract) | Clean — see analysis below |
| `entropyCallback` (line 459) | `IEntropyConsumer` base enforces `msg.sender == entropy` before forwarding to this override. Additional check `provider != entropyProvider` (line 469). | State updated synchronously; no external calls inside the callback. | None | Clean |
| `emergencyForceSettle` (line 778) | `nonReentrant`, `onlyOwner` | State changes only; no external calls | None | Clean |

**Analysis of the unguarded `_commitDraw` path:** Pyth Entropy's `requestWithCallback` does not synchronously invoke the consumer callback; the callback is dispatched asynchronously by the provider in a later transaction. Even if this assumption were violated and the Entropy contract attempted to reenter:

- Reentering `_commitDraw` for the same round would revert at line 627 (`state != RoundState.Open`) because `r.state = RoundState.AwaitingVRF` is already set
- Reentering `buyTickets` would be blocked by `nonReentrant` on `_buyTicketsMON`
- Reentering `claimPrize` or `withdrawPrincipal` for the same round would revert with `BadState` (state is `AwaitingVRF`, not `Settled`)
- Reentering any owner-only function would fail the `onlyOwner` check (caller is the Entropy contract, not owner)

The CEI ordering at lines 644–647 prevents all known reentry attack patterns even without `nonReentrant` on the wrapping function. **Status: clean.**

### 5.2 Access Control

Every owner-only function carries the `onlyOwner` modifier. All twelve owner functions verified:

| Function | Line | Guard |
|----------|------|-------|
| `pause` | 104 | `onlyOwner` |
| `unpause` | 109 | `onlyOwner` |
| `transferOwnership` | 114 | `onlyOwner`; sets `pendingOwner`, requires explicit `acceptOwnership` (line 119) for two-step transfer |
| `setKeeper` | 376 | `onlyOwner` |
| `setFee` | 381 | `onlyOwner`; validates `newFeeBps ≤ MAX_FEE_BPS` (2000); validates recipient ≠ address(0) |
| `queueEntropyChange` | 391 | `onlyOwner`; validates both inputs ≠ address(0) |
| `commitEntropyChange` | 401 | `onlyOwner`; validates pending change exists and `block.timestamp ≥ pendingEntropyEffectiveAt` |
| `cancelEntropyChange` | 415 | `onlyOwner`; validates pending change exists |
| `setNextRoundMetadata` | 425 | `onlyOwner`; address(0) for campaign is intentionally permitted (clears any prior assignment) |
| `depositVRFReserve` | 437 | `onlyOwner`; `payable` |
| `withdrawVRFReserve` | 442 | `onlyOwner`, `nonReentrant` |
| `emergencyForceSettle` | 778 | `onlyOwner`, `nonReentrant`; requires `state == AwaitingVRF` and `vrfRequestTime + VRF_CALLBACK_TIMEOUT` elapsed |

Owner transfer is two-step (`transferOwnership` → recipient calls `acceptOwnership`), eliminating typo-to-burn-address risk.

`isKeeper` is declared as a mapping (line 253) and `onlyKeeper` is declared as a modifier (line 87) but neither is used to gate any state-changing function. This is intentional per ADR-0019: keeper-driven progressions (`executeNext`, `commitDraw`, `skipRound`, `finalizeDraw`) are permissionless because they cannot influence round outcomes (the random number is supplied by Pyth, the winner is computed deterministically from it). The `isKeeper` mapping is preserved for off-chain bots to detect their authorization status. Not a vulnerability.

### 5.3 Randomness

V3 randomness comes from Pyth Entropy (ADR-0014). The user-supplied entropy seed is constructed at `_commitDraw` line 635:

```solidity
bytes32 userRandom = keccak256(abi.encode(
    rid,
    r.totalTickets,
    r.totalPrincipalMON,
    block.prevrandao,
    block.timestamp
));
```

This seed is mixed with Pyth's provider-side entropy. Even if all inputs were known to an attacker (they are public on-chain), the Pyth provider's contribution makes the final `randomNumber` unpredictable until the callback lands.

The winner is selected at `_finalizeDraw` line 674:

```solidity
uint32 winTicket = uint32(uint256(r.randomNumber) % uint256(r.totalTickets));
```

Modulo bias analysis: `randomNumber` is 256 bits; `totalTickets` is bounded by `uint32` (4,294,967,295). The relative bias is at most `totalTickets / 2^256`, which is below 2⁻²²⁴ for any realistic ticket count. Not exploitable.

`finalizeDraw` is permissionless, but the random number is already fixed by the time the function is callable (`state == Drawn` requires the callback to have landed). No callable function can change the outcome at that point.

### 5.4 Pyth Entropy Integration

The contract inherits `IEntropyConsumer` from the Pyth SDK (line 7). The base contract provides an external `_entropyCallback` which enforces `msg.sender == getEntropy()` before forwarding to the override. This contract's `getEntropy` returns `address(entropy)` (line 452).

Internal `entropyCallback` (line 459):

- Looks up the round via `vrfSequenceToRound[sequence]`; returns silently if unknown
- Verifies `r.state == AwaitingVRF`; returns silently if already processed
- Verifies `provider == entropyProvider`; **reverts** with `WrongProvider` if not
- Stores the random number and transitions state to `Drawn`

The two silent returns are intentional and safe: they prevent reentry-style double-processing of an already-handled callback without bricking the round. The hard revert on `WrongProvider` prevents a malicious Pyth-controlled entropy contract from feeding a callback from an unauthorized provider.

**Entropy address mutability (ADR-0021):** `entropy` and `entropyProvider` are mutable owner-controlled storage, but only via the two-step timelock (`queueEntropyChange` + 24h wait + `commitEntropyChange`). The 24h gap is observable via the `EntropyChangeQueued` event, giving depositors a public exit window before any change takes effect. This is the trust assumption explicitly documented in ADR-0022 §3.

### 5.5 Fee Snapshot Integrity (ADR-0020)

Fee parameters are snapshotted into each round at open time and read at settle time:

- Constructor round 1 snapshot: lines 364–365 (`r.roundFeeBps = feeBps`, `r.roundFeeRecipient = feeRecipient`)
- `_startNextRound` snapshot: lines 764–765
- `_finalizeDraw` read: line 711 (`r.roundFeeBps`)

The live storage (`feeBps`, `feeRecipient` at lines 267–268) is updated by `setFee` (line 381) but the snapshot is not. Verified: there is no code path that re-reads `feeBps` or `feeRecipient` during settlement of a round opened prior to a fee change.

`MAX_FEE_BPS` enforcement: `setFee` reverts with `FeeTooHigh` if `newFeeBps > 2000` (line 382). `MAX_FEE_BPS` is `constant`, not mutable. Owner cannot exceed the 20% ceiling.

`feeRecipient` non-zero invariant: constructor sets it to `msg.sender` (line 349); `setFee` rejects `address(0)`. Always non-zero in storage. Snapshot inherits this.

### 5.6 Share-Accounting Invariant

The contract maintains `totalUnclaimedShares` to track all shMON shares owed to users. The invariant per the contract's own comment block (lines 700–705):

```
+deposit:           totalUnclaimedShares += depositedShares
+finalize:          totalUnclaimedShares -= feeShares
−withdrawPrincipal: totalUnclaimedShares -= principalSharesAtSettle × userProportion
−claimPrize:        totalUnclaimedShares -= netPrizeShares
net:                0
```

For a round with N depositors and total `totalPrincipalMON`, the sum of withdrawals is:

```
Σ sharesToReturn_i = Σ (userMON_i × principalSharesAtSettle / totalPrincipalMON)
                   ≤ principalSharesAtSettle    (integer division rounds down)
```

Plus the prize claim: `+ netPrizeShares = + (grossPrizeShares - feeShares)`.
Plus the fee transfer at settle: `+ feeShares`.

Total outflow: `≤ principalSharesAtSettle + grossPrizeShares = totalPrincipalShmonShares`.
Total inflow (deposit time): `+ totalPrincipalShmonShares`.

**Net `totalUnclaimedShares` change for a fully-claimed round: ≤ 0**, with the residual being per-user precision dust from integer division. The accounting can leak shares in the protocol's direction (residual stays in the contract), but cannot over-pay users. Not exploitable.

### 5.7 Round Lifecycle Transitions

Verified all state transitions:

| Transition | Triggering function | Validations |
|------------|---------------------|-------------|
| (new) → `Open` | `_startNextRound` (lines 759–769), constructor | None — internal only |
| `Open` → `AwaitingVRF` | `_commitDraw` (line 624) | `state == Open`, `block.timestamp ≥ salesEndTime + yieldPeriodSec`, `totalTickets > 0`, contract balance ≥ VRF fee |
| `AwaitingVRF` → `Drawn` | `entropyCallback` (line 459) | `state == AwaitingVRF`, `provider == entropyProvider` |
| `Drawn` → `Settled` | `_finalizeDraw` (line 668) | `state == Drawn`, `totalTickets > 0` |
| `Open` → `Settled` (skip) | `_skipRound` (line 731) | `state == Open`, sales ended, all aggregates zero |
| `AwaitingVRF` → `Settled` (emergency) | `emergencyForceSettle` (line 778) | `state == AwaitingVRF`, callback timeout reached, owner-only |

No state transition can be triggered out-of-order. The `state != X revert BadState()` checks at the top of each transition prevent re-entry into already-progressed states.

### 5.8 Edge Cases Verified

| Edge case | Behavior | Status |
|-----------|----------|--------|
| Zero-ticket round | `_skipRound` requires `totalTickets == 0` and clean aggregates; sets `prizeClaimed = true`. | OK |
| Round with yield exactly zero | `grossPrizeShares = 0`, `feeShares = 0`. `withdrawPrincipal` takes the `prizeShares == 0` branch and returns exact deposited share count. | OK |
| Winner withdraws principal before claiming prize | Distinct state slots; both succeed independently | OK |
| Winner claims prize after withdrawing principal | Same — `prizeClaimed` flag is separate from `principalShmonShares` | OK |
| Non-winner depositor calls `claimPrize` | Reverts with `NotWinner` (line 836) | OK |
| Winner calls `claimPrize` twice | Second call reverts with `PrizeAlreadyClaimed` (line 835) | OK |
| Winner calls `claimPrize` on a skipped/emergency-settled round | `prizeClaimed = true` is set by `_skipRound`/`emergencyForceSettle`, so revert | OK |
| `claimPrize` with `prizeShares == 0` | Sets `prizeClaimed = true`, no transfer. Idempotent. | OK |
| `withdrawPrincipal` on a settled round when user deposited zero | Reverts with `NothingToWithdraw` (line 868) | OK |
| `entropyCallback` for a sequence never assigned | `rid == 0`, function returns silently (line 465). | OK |
| `entropyCallback` from wrong provider | Reverts with `WrongProvider` (line 469). | OK |
| `entropyCallback` arrives after `emergencyForceSettle` | `r.state == Settled`, function returns silently (line 468). | OK |
| `commitEntropyChange` called before timelock elapsed | Reverts with `TimelockNotElapsed` (line 403) | OK |
| `commitEntropyChange` with no pending change | Reverts with `NoPendingEntropyChange` (line 402) | OK |
| Re-queue an entropy change while one is pending | Overwrites pending; resets timer (documented). | OK |
| `_ownerOfTicket` with `ticketId >= totalTickets` | Reverts with `TicketOOB` (line 978), preventing the `n - 1` underflow surface that follows | OK |
| Owner withdraws VRF reserve while a round is in `AwaitingVRF` | Reserve drained; next `_commitDraw` reverts `InsufficientVRFFee`. Existing `AwaitingVRF` round is unaffected. | OK |

### 5.9 Trust Model Verification (ADR-0022)

Each documented owner power from ADR-0022 verified against code:

| Power (ADR-0022) | Implementation | Cap / mitigation |
|-------------------|----------------|------------------|
| Set protocol fee | `setFee` (line 381) | Hardcoded `MAX_FEE_BPS = 2000` (20%); snapshot at round open prevents retroactive change |
| Set keeper | `setKeeper` (line 376) | Keeper has no on-chain privileges in this contract |
| Change Pyth Entropy contract/provider | `queueEntropyChange` + `commitEntropyChange` (lines 391, 401) | 24h public timelock; `EntropyChangeQueued` event for observability |
| Set per-round metadata | `setNextRoundMetadata` (line 425) | Affects only next round; cannot retroactively tag existing rounds |
| Manage VRF reserve | `depositVRFReserve`, `withdrawVRFReserve` (lines 437, 442) | Funds are owner's; not commingled with user shares |
| Pause/unpause | `pause`, `unpause` (lines 104, 109) | Cannot block `claimPrize`, `withdrawPrincipal`, or `finalizeDraw` |
| Transfer ownership | `transferOwnership` + `acceptOwnership` (lines 114, 119) | Two-step; typo-resistant |

All powers enforced; no admin path bypasses the documented constraint.

---

## 6. Informational Observations (below reporting threshold)

These are recorded for the operator's awareness only. None are vulnerabilities and none block deployment.

### 6.1 `isKeeper` mapping and `onlyKeeper` modifier are declared but unused

- **Location:** lines 87–90 (modifier), 211 (error), 253 (mapping), 348 (set in constructor), 376–379 (setter)
- **Observation:** The `onlyKeeper` modifier is declared and the `NotKeeper` error is defined, but no function in the contract uses the modifier. Keeper-driven progressions are intentionally permissionless per ADR-0019.
- **Operator action:** Optional cleanup in a future version. Not a security issue.
- **Confidence as vulnerability:** 1/10 (it's not one)

### 6.2 `receive()` accepts arbitrary native MON donations

- **Location:** line 1005
- **Observation:** Anyone can send MON to the contract. The funds become part of the owner-managed VRF reserve, recoverable via `withdrawVRFReserve`.
- **Risk:** None. User MON in the deposit path is immediately converted to shMON shares via `shmon.deposit{value: cost}(...)` at line 509, so the contract's native MON balance is exclusively VRF reserve.
- **Confidence as vulnerability:** 2/10

### 6.3 `setKeeper` accepts `address(0)`

- **Location:** line 376
- **Observation:** No `keeper != address(0)` check. Owner could authorize the zero address as a keeper.
- **Risk:** None, because `isKeeper` is never used as a permission gate. Cosmetic.
- **Confidence as vulnerability:** 1/10

### 6.4 `getRoundInfo` returns `shareRateAtSettle = 0` (reserved)

- **Location:** line 937
- **Observation:** The `shareRateAtSettle` field in the return tuple is always zero, marked as "reserved for future."
- **Risk:** UX / off-chain integration concern, not a contract security issue.
- **Confidence as vulnerability:** 0/10

### 6.5 Theoretical: if `feeRecipient` later becomes unable to receive shMON, in-flight rounds with non-zero `feeShares` could become unsettlable

- **Location:** line 716 (`shmon.transfer(r.roundFeeRecipient, feeShares); require(ok, "fee transfer failed");`)
- **Observation:** The fee recipient is snapshotted at round open and used at settle. If between open and settle the recipient becomes unable to receive shMON (hypothetical future blacklist, recipient self-destructs as a contract), `_finalizeDraw` would revert and the round would freeze in `Drawn` state.
- **Why below threshold:** shMON's actual implementation has no blacklist or transfer restriction. ERC-20 `transfer` to any non-zero address credits balance unconditionally. The recipient is initialized to `msg.sender` (an EOA) in the constructor and validated as non-zero in `setFee`. A self-destructing recipient contract is owner's choice and avoidable.
- **Operator action:** When selecting a `feeRecipient`, use an EOA or a contract verified to handle standard ERC-20 receipts. Do not point at contracts with non-trivial fallback logic.
- **Confidence as vulnerability:** 6/10 (theoretical; depends on operator behavior and shMON properties remaining as today)

---

## 7. ADR Cross-Check Summary

| ADR | Subject | Implementation status |
|-----|---------|----------------------|
| ADR-0010 | Cadence invariant (24h round, ~6d yield, 1 MON ticket) | Constructor accepts these as args; deployed values match (verified in `deployments/monad-mainnet.json`) |
| ADR-0012 | Reentrancy trust model | `nonReentrant` applied to all user-facing state-changers and owner withdrawal; CEI ordering verified |
| ADR-0013 | Randomness security model | Pyth VRF used; no blockhash dependencies in winner selection |
| ADR-0014 | Pyth Entropy as launch VRF | Implemented via `IEntropyConsumer`; provider validation in callback |
| ADR-0015 | VRF failover playbook | `emergencyForceSettle` provides 1h-timeout escape; entropy timelock enables provider migration |
| ADR-0019 | V3 mainnet migration | Contract has Pyth state, no requestUnstake, share-based settlement |
| ADR-0020 | Protocol fee on yield | `setFee` with `MAX_FEE_BPS = 2000`; snapshot in round struct; `ProtocolFeeAccrued` event |
| ADR-0021 | Pre-deploy hardening | `VERSION` constant, entropy timelock, OwnershipTransferred 2-arg, VRF reserve events indexed, VRF sequence indexed, per-round metadata |
| ADR-0022 | Operational trust assumptions | Every documented power enforced; no undocumented privilege paths |

All ADR commitments verified in code. No undocumented privilege escalation paths discovered.

---

## 8. Recommendations

### Required before further deployment

None.

### Recommended hardening (Phase 2)

These are not required for the planned Vault B V3 deploy but should be considered for the next major version:

1. **Multi-signature owner.** Migrate the owner key to a Safe with at least 2 signers. Reduces the single-key compromise blast radius for all owner privileges. Recommended within 3 months of mainnet launch. Tracked in ADR-0022 §"Open follow-ups".

2. **Timelock on pause.** Currently `pause()` takes effect immediately. A compromised owner key could pause the protocol indefinitely. While paused, users can still claim and withdraw from settled rounds (verified), but new deposits and progressions are blocked. A 1–2 hour delay on pause would give users a window to react. Trade-off: slower emergency response.

3. **Removal of unused `isKeeper`/`onlyKeeper` surface** (informational, not security). Reduces the contract's apparent surface area for auditors.

4. **Bytecode verification publication.** Publish the `runtimeBytecodeSha256` from `deployments/monad-mainnet.json` to a public canary so anyone can independently verify the deployed bytecode matches the audited source.

### Operational recommendations (not contract changes)

1. Maintain VRF reserve well above the expected per-round fee. Current 20 MON ÷ 0.77 MON ≈ 26 rounds of runway per vault. Set up a Telegram alert when reserve drops below 10 MON.
2. Monitor `OwnershipTransferred`, `EntropyChangeQueued`, `FeeUpdated`, and `EmergencyForceSettled` events. Any of these firing unexpectedly is a sign of compromise or operational error.
3. Practice the disaster recovery procedure (`tasks/disaster-recovery-runbook.md`) at least once before going on extended leave.

---

## 9. Sign-Off

This audit covers the source as of commit `186f1ad` (staging HEAD, 2026-05-28). The contract is fit for the planned Vault B V3 deployment on 2026-05-31 01:00 UTC.

**Audit limitations:** This is an internal review by an LLM-based auditor, not a substitute for independent third-party human audit. Recommendations:

- Before significantly raising the TVL beyond bootstrapping (>1000 MON in any single vault), commission an independent human audit firm to re-review the same source.
- Any future contract changes (V3.1, V4, etc.) require a fresh audit cycle. The clean result for V3.0.0 does not transfer.

**Files referenced:**
- `src/TicketPrizePoolShmonV3.sol` (audited)
- `decisions/0010-cadence-invariant-for-vault-a-and-b.md`
- `decisions/0012-reentrancy-trust-model.md`
- `decisions/0013-randomness-security-model.md`
- `decisions/0014-vrf-launch-requirement-pyth-entropy.md`
- `decisions/0015-vrf-failover-playbook.md`
- `decisions/0019-v3-mainnet-migration.md`
- `decisions/0020-protocol-fee.md`
- `decisions/0021-v3-pre-deploy-hardening.md`
- `decisions/0022-operational-trust-assumptions.md`
- `deployments/monad-mainnet.json`

---

*End of audit report.*
