# Smart Contract Security Audit - TicketPrizePoolV4

**Contract:** `TicketPrizePoolV4` (`src/TicketPrizePoolV4.sol`)  
**Primary source revision:** V4 mainnet launch lineage recorded in `decisions/0032-v4-launch-record.md` and `deployments/monad-mainnet.json`  
**Auditor:** Internal EverDraw security review  
**Date:** 2026-06-05  
**V4.1 addendum:** 2026-06-08, covering the additive direct-shMON deposit update  
**Scope:** V4 prize vault, Pyth randomness adapter, V4 interfaces, ABI surface, deployment manifest, and V4/V4.1 Foundry test coverage.

---

## 1. Executive Summary

`TicketPrizePoolV4` is the current EverDraw production vault contract. It is a non-upgradeable prize-savings vault that tracks depositor principal separately from prize yield, uses shMON as the production yield vault, supports permissionless round progression, and uses Pyth Entropy through a vault-specific randomness adapter.

**Bottom line: no critical, high, or medium-severity vulnerabilities were found at high confidence in the reviewed V4/V4.1 scope.**

The review raised only low-severity and defense-in-depth observations. The automated static-analysis pass corroborated the manual review and did not identify a contradictory high-confidence issue in the production V4 surface.

EverDraw still treats this as an internal audit. A formal third-party audit is planned before TVL scales beyond bootstrapping levels.

---

## 2. Scope

### In scope

- `src/TicketPrizePoolV4.sol`
- `src/PythRandomnessOracle.sol`
- `src/interfaces/IRandomnessOracle.sol`
- `src/interfaces/IRandomnessOracleConsumer.sol`
- `src/interfaces/IYieldVault.sol`
- `abi/TicketPrizePoolV4.json`
- V4 deployment records in `deployments/monad-mainnet.json`
- V4 design and launch ADRs: ADR-0024 through ADR-0035
- V4 Foundry suites under `test/V4_*.t.sol`

### V4.1 addendum scope

The V4.1 review covered the additive direct-shMON deposit release:

- `buyTicketsShmon(uint32 ticketCount)`
- `getWithdrawableShares(uint256 rid, address user)`
- `getRoundTicketPrice(uint256 rid)`
- ABI regeneration for the new functions
- Preservation of the existing native-MON deposit path

### Out of scope

- The shMON vault implementation itself, except as a trusted ERC-4626/ERC-20 dependency
- Pyth Entropy internals, except as a trusted randomness dependency
- Private-key custody, hosting, DNS, and keeper operations beyond the documented trust model
- Frontend and indexer business logic, except where their expected contract reads/writes affect the ABI review

---

## 3. Methodology

The review combined:

1. **Manual architecture pass** - mapped the round lifecycle, payout accounting, admin roles, immutable configuration, and dependency boundaries.
2. **Adversarial pass** - tested attacker models for depositors, sponsors, keepers, owner/pauser keys, oracle failure, yield-vault transfer failure, and stale off-chain services.
3. **ADR cross-check** - verified implementation behavior against the V4 ADR set, especially randomness, multi-winner accounting, sponsor refunds, fee routing, transfer resilience, pausing, stop semantics, and shMON direct deposits.
4. **Automated static analysis** - ran Slither against the V4 surface and reviewed the output against the manual findings.
5. **Test-suite review** - reviewed the V4 Foundry suites and the V4.1 shMON-deposit test additions.

---

## 4. Findings Summary

| Severity | Result |
|---|---|
| Critical | None found |
| High | None found |
| Medium | None found at high confidence |
| Low / defense-in-depth | Documented below |

No finding in this report indicates a path for an attacker to steal depositor principal, redirect prize shares, bias a completed randomness result, retroactively change round economics, or permanently block settled-round withdrawals.

---

## 5. Key Properties Verified

### Principal accounting

Depositor principal is tracked separately from prize yield. Principal claims are based on the depositor's recorded principal shares and the round settlement snapshot. Prize, fee, sponsor, and forfeit accounting do not give the owner or keeper a path to move depositor principal.

### Non-upgradeability

The production V4 vaults are direct deployments, not proxies. Protocol changes require new contracts and manifest updates rather than an upgrade key.

### Randomness

V4 uses an oracle abstraction with the production adapter pinned to Pyth Entropy. The vault records request IDs, accepts callbacks only from the configured oracle path, and finalizes winners deterministically after randomness is received. Oracle migration is gated behind the documented time-delay.

### Admin and pauser boundaries

Owner powers are bounded by hardcoded limits and per-round snapshots. The owner cannot:

- Move user principal
- Change a round's prize, fee, or winner after the round opens
- Raise total protocol fees above the hard cap
- Instantly swap the randomness oracle
- Pause settled-round claims or withdrawals

The pauser role can stop new deposits and progression, but cannot block settled-round exits.

### Transfer resilience

Yield-vault share payouts are wrapped so a failed transfer records a retriable pending claim instead of losing the user's payout. This covers prize, principal, fee, and sponsor-refund payout paths.

### V4.1 direct-shMON deposit

The V4.1 additive path pulls shMON shares directly from the user, credits principal in MON-denominated asset units, credits shares using the received shMON amount, emits the same deposit/ticket events used by the native path, and leaves settlement/withdrawal math share-based. The native-MON path remains available.

---

## 6. Low-Severity / Defense-In-Depth Observations

### L-01 - Internal audit is not a substitute for a third-party audit

**Impact:** Process risk.  
**Status:** Accepted pending external audit.

The review was internal. The security page correctly warns users not to treat this as a third-party audit and states that a formal audit is planned before scaling TVL beyond bootstrapping levels.

### L-02 - Operational dependencies remain part of the real risk model

**Impact:** Availability / operational risk.  
**Status:** Documented in ADRs and docs.

Keeper, indexer, frontend, DNS, RPC, owner-key, and randomness-provider failures do not directly give an attacker depositor principal, but they can delay UX, progression, or publication. The deployment manifest and ADRs remain the source of truth for recovery and verification.

### L-03 - shMON is a trusted dependency

**Impact:** Dependency risk.  
**Status:** Accepted and documented.

EverDraw's production yield source is shMON. If shMON accounting or transfers were wrong, EverDraw would inherit that failure. V4 reduces additional protocol-side accounting risk but does not remove dependency risk from the underlying yield vault.

### L-04 - V4.1 docs and integrator guidance must stay synchronized with the ABI

**Impact:** Integration risk.  
**Status:** Addressed by publishing the V4.1 version update and ABI references.

The V4.1 release adds `buyTicketsShmon`, `getWithdrawableShares`, and `getRoundTicketPrice`. Integrators should rely on `abi/TicketPrizePoolV4.json` and the developer version-update notes rather than copying older V4.0 examples.

---

## 7. Verification Artifacts

- Deployment manifest: [`deployments/monad-mainnet.json`](../deployments/monad-mainnet.json)
- V4 launch record: [`decisions/0032-v4-launch-record.md`](../decisions/0032-v4-launch-record.md)
- V4.1 direct-shMON ADR: [`decisions/0035-v4-1-shmon-direct-deposit.md`](../decisions/0035-v4-1-shmon-direct-deposit.md)
- ABI: [`abi/TicketPrizePoolV4.json`](../abi/TicketPrizePoolV4.json)
- V4 tests: [`test/V4_*.t.sol`](../test/)

---

## 8. User-Facing Status

The internal V4/V4.1 review is complete and published. The production warning remains:

**Until a third-party audit is complete, do not deposit more than you are comfortable losing.**
