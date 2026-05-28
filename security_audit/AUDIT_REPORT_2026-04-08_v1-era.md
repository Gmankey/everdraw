> ## ⚠️ Historical Audit — Superseded
>
> **This report dates from 2026-04-08 and audits the V1-era contracts** (`TicketPrizePoolShmonShMonad`, `TicketPrizePool`, `TicketPrizePoolShmon`, `PrizeVault`). It predates the V2 cadence-invariant work ([ADR-0010](../decisions/0010-cadence-invariant-for-vault-a-and-b.md), May 2026), the V2 source-recovery work ([ADR-0016](../decisions/0016-production-v2-source-recovery.md), May 2026), and the V3 redesign with Pyth Entropy VRF ([ADR-0019](../decisions/0019-v3-mainnet-migration.md), May 2026).
>
> **What changed since this audit was written:**
>
> - **Blockhash PRNG manipulation (Critical)** — addressed by ADR-0014 (Pyth Entropy as launch VRF). V3 contracts no longer use blockhashes for winner selection. V2 contracts still in operation are being retired and have no new rounds opening.
> - **Emergency force-settle principal loss (Critical)** — V3 `emergencyForceSettle` only handles `AwaitingVRF` timeouts and leaves principal recoverable by every depositor at full deposited share count (`prizeShares == 0` branch in `withdrawPrincipal`). See [ADR-0015](../decisions/0015-vrf-failover-playbook.md) for the V3 design.
> - **Legacy contracts (`TicketPrizePool`, `TicketPrizePoolShmon`, `PrizeVault`)** — not deployed to mainnet at any point; their deploy scripts and source remain in the repo for historical reference only.
> - **Legacy Vault B `0xed67ad46...`** — quarantined per [ADR-0018](../decisions/0018-legacy-vault-b-quarantine.md). Retired from active operation. Existing depositors can still claim.
>
> **For the current production review**, see [`AUDIT_REPORT_V3_2026-05-28.md`](./AUDIT_REPORT_V3_2026-05-28.md) — the V3 internal audit of `TicketPrizePoolShmonV3` at commit `186f1ad`.
>
> The findings below are retained for the historical record and for any third-party auditor who wants to trace the protocol's evolution. They do not reflect risks against the current V3 production contracts.

---

# EverDraw Security Audit Report

**Project:** EverDraw — No-Loss Lottery on Monad
**Scope:** `src/` directory (5 Solidity files)
**Compiler:** solc 0.8.33 (Foundry)
**Date:** 2026-04-08
**Methodology:** Map-Hunt-Attack with Devil's Advocate verification
**Auditor:** Automated security audit via Claude Code

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Scope](#scope)
- [Methodology](#methodology)
- [Findings Summary](#findings-summary)
- [Critical Findings](#critical-findings)
- [High Findings](#high-findings)
- [Medium Findings](#medium-findings)
- [Low Findings](#low-findings)
- [Informational Findings](#informational-findings)
- [Design Tradeoffs](#design-tradeoffs)
- [Invalidated Findings](#invalidated-findings)
- [Static Analysis Summary](#static-analysis-summary)
- [System Architecture](#system-architecture)
- [Protocol Invariants](#protocol-invariants)
- [Remediation Roadmap](#remediation-roadmap)

---

## Executive Summary

This audit examined 5 Solidity contracts comprising the EverDraw no-loss lottery protocol on Monad. The audit identified **4 Critical, 2 High, 5 Medium, 10 Low, and 1 Informational** findings across 28 investigated hotspots. 1 hotspot was fully invalidated. 6 findings were confirmed with executable Foundry proof-of-concept exploits.

The **production contract** (`TicketPrizePoolShmonShMonad`) has **1 Critical** (blockhash PRNG manipulation) and **1 Critical** (emergency force settle principal loss) confirmed finding. The **legacy contracts** (`TicketPrizePool`, `TicketPrizePoolShmon`, `PrizeVault`) carry additional critical issues but remain in the codebase with deploy scripts.

### Key Risk Areas

| Risk | Severity | Status |
|------|----------|--------|
| Predictable randomness + unlimited re-rolls | Critical | PoC confirmed |
| Emergency force settle destroys all principal | Critical | PoC confirmed |
| PrizeVault unchecked ERC-20 transfers | Critical | PoC confirmed |
| Legacy contract has no emergency escape | Critical | Code-confirmed |
| Shared staker yield inflation | High | PoC confirmed |
| ShMonad failure cascades to total fund loss | High | PoC confirmed |

---

## Scope

| File | Lines | Description |
|------|-------|-------------|
| `src/Counter.sol` | ~15 | Trivial test contract (out of security scope) |
| `src/PrizeVault.sol` | ~40 | Simple ERC-20 deposit/withdraw vault |
| `src/TicketPrizePool.sol` | ~335 | Single-round no-loss lottery with IStaker |
| `src/TicketPrizePoolShmon.sol` | ~290 | Multi-round lottery with SHMON staking |
| `src/TicketPrizePoolShmonShMonad.sol` | ~760 | **Production** lottery with owner controls, pause, reentrancy guards |

### Contract Lineage

The three lottery contracts form an evolutionary lineage:

```
TicketPrizePool (v1)
  - Single-round, native token, commit-reveal entropy
  - No owner, no emergency, no recommit
  - Uses staker.totalUnderlying() for yield

    |
    v

TicketPrizePoolShmon (v2)
  - Multi-round, SHMON staking, overlapping rounds
  - No owner, no emergency, no reentrancy guard
  - Uses claimUnstake return value for yield

    |
    v

TicketPrizePoolShmonShMonad (v3 - PRODUCTION)
  - Owner controls, pause, nonReentrant
  - executeNext() automation, recommit mechanism
  - emergencyForceSettle after 14-day timeout
  - Uses balance-delta for yield measurement
```

---

## Methodology

### Map-Hunt-Attack with Devil's Advocate

1. **SETUP**: Static analysis via Slither and Aderyn, checklist generation
2. **MAP**: Architecture analysis — components, invariants, trust boundaries, 34 audit units
3. **HUNT**: 6 parallel specialized lanes (Callback Liveness, Accounting Entitlement, Semantic Consistency, Token Oracle Statefulness, Economic Differential, Adversarial Deep)
4. **ATTACK**: Per-hotspot Devil's Advocate protocol attempting to disprove each hypothesis before confirming, with Foundry PoC generation
5. **REPORT**: Structured output with severity, confidence, proof type, and remediation

### Devil's Advocate Protocol

Every finding underwent a structured falsification attempt scoring across 6 dimensions:
- **Guards**: Do existing checks prevent the attack?
- **Reentrancy Protection**: Does a mutex or CEI pattern block re-entry?
- **Access Control**: Can only privileged roles trigger it?
- **By Design**: Is this documented intentional behavior?
- **Economic Feasibility**: Is the attack profitable?
- **Dry Run**: Does a concrete step-by-step trace confirm exploitability?

Findings with negative DA scores were **degraded**. Findings with positive scores were **sustained** or **escalated**.

---

## Findings Summary

| Severity | Count | PoC Proved | DA Sustained | DA Degraded |
|----------|-------|------------|-------------|-------------|
| Critical | 4 | 3 | 4 | 0 |
| High | 2 | 2 | 2 | 0 |
| Medium | 5 | 2 | 5 | 0 |
| Low | 10 | 4 | 2 | 8 |
| Informational | 1 | 0 | 0 | 1 |
| Invalidated | 1 | 0 | 0 | 1 |
| **Total** | **23** | **11** | **13** | **10** |

*Note: 5 degraded medium candidates are listed under Low. 2 design tradeoffs are listed separately.*

---

## Critical Findings

### [C-01] Blockhash PRNG Manipulation + Unlimited Recommits Allow Guaranteed Winner Selection

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Confidence** | Confirmed |
| **Proof** | Foundry PoC |
| **Contracts** | `TicketPrizePoolShmonShMonad.sol` (production), `TicketPrizePoolShmon.sol`, `TicketPrizePool.sol` |
| **Lines** | `_drawWinner` L559-563, `_recommit` L414-422 |
| **Category** | Oracle / Randomness |
| **Invariant Violated** | INV-013 |

**Description**

All three lottery contracts derive winner randomness from:

```solidity
bytes32 rnd = keccak256(abi.encodePacked(blockhash(targetBlockNumber), rid));
uint32 winTicket = uint32(uint256(rnd) % uint256(r.totalTickets));
```

Once `targetBlockNumber` is mined, the blockhash is publicly knowable, making the winner **fully deterministic and predictable** before anyone calls `drawWinner()`. The production contracts (`TicketPrizePoolShmon`, `TicketPrizePoolShmonShMonad`) dropped the commit-reveal entropy mix that `TicketPrizePool` had, relying solely on blockhash + roundId.

The `TicketPrizePoolShmonShMonad` contract adds a permissionless `recommit()` function with **no counter, no cooldown, no cost, and no limit**. An attacker can:

1. Compute the winner off-chain for free after the target block is mined
2. Call `drawWinner()` only when the result maps to their ticket
3. If unfavorable, wait 255 blocks for the blockhash window to expire
4. Call `recommit()` to get a new `targetBlockNumber` with a new blockhash
5. Repeat indefinitely until they win

**Proof of Concept Results**

```
test_exploit_HS001_predictable_winner         — PASS (predicted ticket 40, actual 40)
test_exploit_HS001_recommit_reroll_attack      — PASS (10% attacker won after 8 recommits)
test_exploit_HS001_unlimited_recommits         — PASS (20 consecutive recommits, no limit)
test_exploit_HS001_one_percent_attack          — PASS (1% attacker won after 15 recommits)
```

**Impact**

An attacker can **guarantee winning every lottery round** regardless of their ticket share. This breaks the fundamental fairness of the no-loss lottery. The cost is negligible (~2,800 gas per recommit). A 1% ticket holder wins after ~15 recommits on average.

**Remediation**

1. **Primary**: Replace blockhash with a VRF (Chainlink VRF, Pyth Entropy) for cryptographically verifiable randomness
2. **Stopgap**: Add a maximum recommit count (e.g., 3), re-introduce commit-reveal entropy mixing, and restrict `drawWinner` to a designated keeper address

---

### [C-02] PrizeVault Unchecked ERC-20 Transfer Return Values Enable Complete Fund Theft

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Confidence** | Confirmed |
| **Proof** | Foundry PoC |
| **Contract** | `PrizeVault.sol` L20-37 |
| **Category** | Token Integration |
| **Invariant Violated** | INV-001, INV-002, INV-014 |

**Description**

`PrizeVault.deposit()` and `withdraw()` do not check the boolean return value of ERC-20 `transfer()` and `transferFrom()` calls:

```solidity
// deposit() - line 23
asset.transferFrom(msg.sender, address(this), amount);  // return value ignored
balances[msg.sender] += amount;  // credited unconditionally
totalDeposits += amount;

// withdraw() - line 36
asset.transfer(msg.sender, amount);  // return value ignored
```

With non-reverting tokens (e.g., USDT-style that return `false` on failure instead of reverting), an attacker can:

1. Call `deposit(X)` with zero token balance — `transferFrom` returns `false`, no tokens move, but `balances[attacker] += X`
2. Call `withdraw(X)` — sends real tokens from other depositors to the attacker

**Proof of Concept**

```
test_exploit_HS002 — PASS
  Attacker with 0 tokens deposits 1000e18 (phantom balance)
  Attacker withdraws 1000e18 real tokens from vault
  Victim's subsequent withdrawal fails (vault drained)
```

**Impact**

Complete theft of all deposited funds (100% vault TVL).

**Remediation**

Use OpenZeppelin `SafeERC20`:

```solidity
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
using SafeERC20 for IERC20;

// In deposit():
asset.safeTransferFrom(msg.sender, address(this), amount);

// In withdraw():
asset.safeTransfer(msg.sender, amount);
```

---

### [C-03] emergencyForceSettle Sets lossRatio=0 Causing Total Principal Loss for All Users

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Confidence** | Confirmed |
| **Proof** | Foundry PoC |
| **Contract** | `TicketPrizePoolShmonShMonad.sol` L147-163, L666-667 |
| **Category** | Accounting / Entitlement |
| **Invariant Violated** | INV-008, INV-016 |

**Description**

When `shmon.completeUnstake()` permanently reverts, `emergencyForceSettle` is the only escape (callable by owner after 14-day `FINALIZATION_TIMEOUT`). It sets:

```solidity
r.monReceived = 0;
r.yieldMON = 0;
r.lossRatio = 0;   // <-- causes total principal loss
r.state = RoundState.Settled;
```

When users subsequently call `withdrawPrincipal()`:

```solidity
if (r.lossRatio < 1e18) {
    amt = (amt * r.lossRatio) / 1e18;  // amt = (principal * 0) / 1e18 = 0
}
```

All users receive **zero MON**. Their `principalMON` is zeroed (preventing retry), and the round is irreversibly marked as `Settled`. The shMON shares may later become claimable from ShMonad, but the contract has **no recovery mechanism** to retrieve and distribute them.

**Proof of Concept**

```
test_exploit_HS004_emergencyForceSettle_zeroes_principal — PASS
  Alice deposits 5 MON, Bob deposits 3 MON
  emergencyForceSettle sets lossRatio=0
  Alice withdraws: receives 0 MON
  Bob withdraws: receives 0 MON
  Total loss: 8 MON (100%)
```

**Impact**

100% permanent loss of all user principal for any force-settled round. Directly violates the "no-loss" guarantee. Conflicts with INV-008 ("users can always withdraw their principal after settlement").

**Remediation**

Option A (recommended): Set `r.lossRatio = 1e18` instead of `0` so users can withdraw their full principal from the contract's existing balance.

Option B: Add try-catch on `completeUnstake` within `emergencyForceSettle` — if it succeeds, compute lossRatio normally.

Option C: Add a separate recovery function that can later call `completeUnstake` and distribute recovered MON to affected users.

---

### [C-04] TicketPrizePoolShmon Has No Emergency Escape Hatch — Permanent Fund Lock

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Confidence** | Likely |
| **Proof** | Code inspection (no PoC — trivially verifiable) |
| **Contract** | `TicketPrizePoolShmon.sol` L181-281 |
| **Category** | Liveness |
| **Invariant Violated** | INV-004, INV-008 |

**Description**

`TicketPrizePoolShmon` has:

- **No owner** — no privileged role exists
- **No pause mechanism** — cannot halt operations
- **No emergency force settle** — no way to bypass stuck state
- **No fallback withdrawal** — no alternative path to recover funds

The round lifecycle depends entirely on the external `IShmonadStaker` cooperating:

- `drawWinner()` calls `staker.requestUnstake()` — if this reverts, round stuck in `Committed`
- `settleRound()` calls `staker.claimUnstake()` — if this reverts, round stuck in `Finalizing`
- `withdrawPrincipal()` requires `state == Settled` — unreachable if either call reverts

If the staker contract is paused, upgraded with a breaking change, self-destructed, or has a bug, **all user principal is permanently and irrecoverably locked**.

The production contract (`TicketPrizePoolShmonShMonad`) addresses this with `emergencyForceSettle()` after a 14-day timeout, confirming the development team recognized this risk — but `TicketPrizePoolShmon` retains a deploy script and no deprecation warning.

**Impact**

Permanent 100% fund lock for all round participants with zero recovery path.

**Remediation**

Option A: Add an owner-controlled `emergencyForceSettle()` function with a time lock.

Option B: Add a time-locked emergency withdrawal allowing users to withdraw principal directly after a sufficiently long timeout (e.g., 30 days) regardless of round state.

Option C: Mark `TicketPrizePoolShmon` as deprecated, remove its deploy script, and add prominent warnings.

---

## High Findings

### [H-01] TicketPrizePool.finalizeDraw Uses Global totalUnderlying() — Steals External Staker Depositors

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Confidence** | Confirmed |
| **Proof** | Foundry PoC |
| **Contract** | `TicketPrizePool.sol` L248-255 |
| **Category** | Accounting / Entitlement |
| **Invariant Violated** | INV-003, INV-004 |

**Description**

`finalizeDraw()` computes yield using a global view function:

```solidity
uint256 underlyingNow = staker.totalUnderlying();
require(underlyingNow >= principal, "staker insolvent");
uint256 yield = underlyingNow - principal;
staker.unstake(principal + yield, address(this));
```

`totalUnderlying()` returns the total balance across **ALL depositors** in the staker, not just this pool's share. If the staker is shared with other contracts or users, the yield calculation includes their funds as "yield."

**Proof of Concept**

```
test_exploit_HS007_inflatedYieldFromSharedStaker — PASS
  Pool stakes 5 ETH principal
  External depositor has 100 ETH in same staker
  Real yield: 1 ETH
  totalUnderlying() returns 106 ETH
  Computed yield: 101 ETH (should be 1 ETH)
  unstake(106 ETH) drains staker completely
  Winner receives 101 ETH prize (100 ETH stolen)
```

**Impact**

Theft of all external staker depositors' funds. The staker becomes insolvent for its other users.

**Remediation**

Replace `totalUnderlying()` with a balance-delta measurement:

```solidity
uint256 balBefore = address(this).balance;
staker.unstake(roundPrincipal[roundId], address(this));
uint256 received = address(this).balance - balBefore;
uint256 yield = received > roundPrincipal[roundId] ? received - roundPrincipal[roundId] : 0;
```

---

### [H-02] ShMonad Failure Cascades to 14-Day Protocol DoS + Irrecoverable Principal Loss

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Confidence** | Confirmed |
| **Proof** | Foundry PoC |
| **Contract** | `TicketPrizePoolShmonShMonad.sol` L581-616, L147-163 |
| **Category** | Liveness / Accounting |
| **Invariant Violated** | INV-004, INV-008, INV-016 |

**Description**

If `shmon.completeUnstake()` permanently reverts:

1. `_settleRound()` is blocked (no try-catch on `completeUnstake`)
2. `activeFinalizingRoundId` remains non-zero, **blocking ALL subsequent rounds** from progressing past `Committed` (`drawWinner` reverts with `FinalizationBusy`)
3. The entire protocol is DoS'd for **14 days** (`FINALIZATION_TIMEOUT`)
4. After 14 days, `emergencyForceSettle` sets `lossRatio=0` (see C-03), causing total principal loss
5. Even if ShMonad later recovers, the round is irreversibly `Settled` — no function can retrieve the funds

**Proof of Concept**

```
test_exploit_HS008_emergencyForceSettle_total_principal_loss — PASS
  3 users deposit 1 MON each, ShMonad breaks
  activeFinalizingRoundId blocks all future rounds
  After 14 days: emergencyForceSettle → lossRatio=0
  All 3 users withdraw: receive 0 MON each

test_exploit_HS008_no_recovery_after_emergency_settle — PASS
  ShMonad recovers after emergency settle
  settleRound reverts (round already Settled)
  3 MON permanently stranded in ShMonad
```

**Impact**

14-day full protocol DoS + total principal loss + permanently irrecoverable funds even after ShMonad recovery.

**Remediation**

1. Add try-catch in `emergencyForceSettle` to attempt `completeUnstake` before zeroing accounting
2. Add a post-settlement recovery function that can call `completeUnstake` and distribute funds to affected users
3. Add try-catch in `_settleRound` so transient failures don't require emergency settlement

---

## Medium Findings

### [M-01] PrizeVault Fee-on-Transfer Token Causes Progressive Insolvency

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Confidence** | Likely |
| **Proof** | Foundry PoC |
| **Contract** | `PrizeVault.sol` L20-27 |

**Description**

`deposit()` credits the caller-supplied `amount` without measuring actual tokens received (no balance-delta). With fee-on-transfer tokens, the vault receives less than credited, causing `totalDeposits > actual balance`. Last withdrawers cannot withdraw their full balance.

**Note:** PrizeVault is not the production contract. The live system uses `TicketPrizePoolShmonShMonad` with native MON.

**Remediation**

Use balance-before/after pattern or document that only standard ERC-20 tokens are supported.

---

### [M-02] TicketPrizePoolShmon Blindly Trusts staker.claimUnstake Return Value

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Confidence** | Likely |
| **Proof** | Foundry PoC |
| **Contract** | `TicketPrizePoolShmon.sol` L214 |

**Description**

`settleRound()` uses `claimUnstake` return value as `monReceived` without verifying actual ETH received. A buggy or upgraded staker returning `0` causes `lossRatio=0`, permanently locking all user principal. The production contract uses balance-delta verification but this contract does not.

**Remediation**

Use balance-delta verification pattern matching `TicketPrizePoolShmonShMonad._settleRound()`.

---

### [M-03] TicketPrizePool Staker Insolvency Permanently Blocks Finalization

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Confidence** | Likely |
| **Contract** | `TicketPrizePool.sol` L249-250 |

**Description**

`finalizeDraw()` has `require(underlyingNow >= principal, "staker insolvent")`. If the staker loses even 1 wei, finalization permanently reverts. The contract has no lossRatio mechanism for partial loss, no emergency settle, and no recommit. All user funds are permanently locked.

**Remediation**

Add a lossRatio mechanism for graceful degradation under staker insolvency, matching the pattern used in later contracts.

---

### [M-04] Blockhash Window Expiry With No Recommit Permanently Locks Funds

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Confidence** | Likely |
| **Contracts** | `TicketPrizePool.sol`, `TicketPrizePoolShmon.sol` |

**Description**

After `commitDraw` sets `targetBlockNumber`, `finalizeDraw`/`drawWinner` must be called within 256 blocks. On Monad (500ms blocks), this is only ~128 seconds. If no one calls within this window, `blockhash()` returns `0` and the draw function permanently reverts. Neither contract has a `recommit()` function (unlike the production contract). Rounds are permanently stuck and funds are locked.

**Remediation**

Add a `recommit()` function matching `TicketPrizePoolShmonShMonad._recommit()`, or increase the blockhash window handling.

---

### [M-05] Missing uint32 Ticket Overflow Check in Legacy Contracts

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Confidence** | Likely |
| **Contracts** | `TicketPrizePool.sol` L198-200, `TicketPrizePoolShmon.sol` L139-141 |

**Description**

The production contract has an explicit guard:

```solidity
require(uint256(start) + uint256(ticketCount) <= type(uint32).max, "ticket overflow");
```

The legacy contracts lack this check. While Solidity 0.8's checked arithmetic prevents silent overflow, the absence of a clear limit enables gas griefing via large ranges arrays at low ticket prices.

**Remediation**

Backport the overflow check from `TicketPrizePoolShmonShMonad`.

---

## Low Findings

### [L-01] TicketPrizePoolShmon Missing Reentrancy Guard (CEI Prevents Exploitation)

**Contract:** `TicketPrizePoolShmon.sol` | **DA Score:** -4 (degraded)

Zero reentrancy protection on any function. Cross-function reentrancy from `claimPrize` into `withdrawPrincipal` is confirmed possible via Foundry PoC. However, CEI pattern (state zeroed before external calls) prevents excess fund extraction — attacker receives only entitled funds.

**Remediation:** Add `nonReentrant` modifier to all state-changing functions.

---

### [L-02] TicketPrizePool Missing Reentrancy Guard (Disjoint State CEI)

**Contract:** `TicketPrizePool.sol` L272-300 | **DA Score:** -4 (degraded)

No reentrancy guard. Cross-function reentrancy between `claimPrize` and `withdrawPrincipal` succeeds but only allows withdrawing legitimately owed amounts (disjoint state variables guarded independently).

**Remediation:** Add `nonReentrant` modifier.

---

### [L-03] PrizeVault Deposit CEI Violation (ERC-777 Not Exploitable)

**Contract:** `PrizeVault.sol` L20-27 | **DA Score:** -3 (degraded)

`deposit()` calls `transferFrom` before updating balances (CEI violation). With ERC-777 tokens, reentrancy occurs but each reentrant call transfers real tokens — additive accounting stays correct. No insolvency produced.

**Remediation:** Add `nonReentrant` or reorder to follow CEI.

---

### [L-04] TicketPrizePool buyTickets CEI Violation (Ranges Stay Correct)

**Contract:** `TicketPrizePool.sol` L195-213 | **DA Score:** -3 (degraded)

External call to `staker.stake` before `totalTickets`/`ranges` update. Foundry PoC proves reentrancy doesn't produce overlapping ranges because outer call reads `totalTickets` after inner call updates it.

**Remediation:** Add `nonReentrant` or reorder.

---

### [L-05] executeNext/Wrapper Functions Partial nonReentrant Coverage

**Contract:** `TicketPrizePoolShmonShMonad.sol` | **DA Score:** -5 (degraded)

`executeNext()` and legacy wrappers lack `nonReentrant`. Unguarded internal functions (`_commitDraw`, `_skipRound`, `_recommit`) make zero external calls, so no callback surface exists.

**Remediation:** Add `nonReentrant` to `executeNext` for defense-in-depth.

---

### [L-06] lossRatio Double-Truncation Rounding Leaves Dust Permanently Locked

**Contracts:** `TicketPrizePoolShmonShMonad.sol`, `TicketPrizePoolShmon.sol` | **DA Score:** -1 (sustained)

Two integer divisions (`lossRatio` computation + per-user scaling) truncate independently. With N users in a loss round, up to N wei of dust is permanently locked with no sweep mechanism. Impact is negligible per round but accumulates.

**Remediation:** Add a dust sweep function or accept as known behavior.

---

### [L-07] Cross-Round Shared ETH Balance Solvency Risk

**Contracts:** `TicketPrizePoolShmonShMonad.sol`, `TicketPrizePool.sol` | **DA Score:** -3 (degraded)

All rounds share `address(this).balance`. Analysis shows this is mostly safe: `_settleRound` uses balance-delta, per-round accounting bounds withdrawals, and single-active-finalizer prevents concurrent settlement. Theoretical insolvency only from accumulated rounding dust.

---

### [L-08] Range Merge Griefing Via Alternating Buyer Addresses

**Contract:** `TicketPrizePoolShmonShMonad.sol` L359-369 | **DA Score:** -3 (degraded)

Alternating buyers bypass the merge optimization, inflating `ranges[]`. Economically self-defeating: attacker pays full gas + ticket costs, impact is only O(log n) binary search overhead.

---

### [L-09] MEV Sandwich on shMON Deposit (No Slippage Protection)

**Contract:** `TicketPrizePoolShmonShMonad.sol` L349-351 | **DA Score:** -3 (degraded)

No minimum shares check on `shmon.deposit()`. Theoretically exploitable via sandwich, but ShMonad is a staking vault (not a DEX) — exchange rate determined by validator rewards, making manipulation infeasible against a mature vault.

---

### [L-10] nonReentrant Modifier Ordering After whenNotPaused

**Contract:** `TicketPrizePoolShmonShMonad.sol` L332 | **DA Score:** -5 (degraded)

`whenNotPaused nonReentrant` ordering is unconventional but has zero security impact. `whenNotPaused` is a pure `require` check with no side effects.

---

## Informational Findings

### [I-01] lossRatio Uses 1e18 Magic Number Without Named Constant

**Contracts:** `TicketPrizePoolShmon.sol`, `TicketPrizePoolShmonShMonad.sol`

9 instances of `1e18` literal for lossRatio precision. All consistent and correct (standard WAD convention). A named constant would improve readability.

---

## Design Tradeoffs

These are intentional architectural decisions that accept risk. They are documented here, not dismissed.

### [DT-01] Missing Slippage Protection on shMON Deposit

**Contract:** `TicketPrizePoolShmonShMonad.sol` L349-351

`buyTickets()` deposits MON into shMON with only a zero-shares check (`if (shares == 0) revert`). No `minShares` parameter exists. The `lossRatio` mechanism explicitly handles the case where shMON returns less than principal — this is documented by-design behavior for socializing external staking risk.

**Recommendation:** Add an optional `minShares` parameter for sandwich protection at the UI layer.

### [DT-02] Uniform lossRatio Ignores Per-User Share Weights

**Contracts:** `TicketPrizePoolShmonShMonad.sol`, `TicketPrizePoolShmon.sol`

`lossRatio` is computed on aggregate `totalPrincipalMON`, not per-user share-weighted basis. In loss scenarios with exchange rate drift during a round, early depositors (more shares) subsidize late depositors (fewer shares). Documented as "proportional loss on principal" — an intentional simplification. Solvency is preserved.

**Recommendation:** Track per-user share contributions for share-weighted distribution, or accept as a known simplification.

---

## Invalidated Findings

### [INV-01] Balance-Delta ETH Injection via receive() — INVALIDATED

**Contract:** `TicketPrizePoolShmonShMonad.sol` L587-592 | **DA Score:** -8

**Hypothesis:** ETH could be injected between `balBefore` and `balAfter` reads in `_settleRound` via the open `receive()` function.

**Invalidation:** EVM transaction atomicity guarantees no external transaction can interleave within a single transaction's execution. The `nonReentrant` modifier further blocks callback-based re-entry. The only ETH arriving between reads is what `shmon.completeUnstake()` intentionally sends. The balance-delta pattern is correct by design.

---

## Static Analysis Summary

### Slither Results

| Severity | Count | Key Detectors |
|----------|-------|---------------|
| High | 7 | weak-prng (3), reentrancy-eth (2), unchecked-transfer (2) |
| Medium | 6 | reentrancy-no-eth (5), incorrect-equality (1) |
| Low | 35 | reentrancy-benign (4), reentrancy-events (11), missing-zero-check (1), timestamp (19) |
| Informational | 8 | assembly (1), pragma (1), low-level-calls (6) |

### Aderyn Results

| Severity | Count | Key Detectors |
|----------|-------|---------------|
| High | 12 | ETH transferred without address checks (3), reentrancy state change (9) |
| Low | 44 | Centralization risk (4), costly loop operations (1), literal constants (18), others |

### Confirmed vs False Positive

- **weak-prng**: Confirmed as C-01
- **unchecked-transfer**: Confirmed as C-02
- **reentrancy-eth** (TicketPrizePoolShmon): Degraded to L-01 (CEI prevents exploitation)
- **reentrancy-no-eth**: Multiple instances degraded by DA analysis
- **ETH transferred without address checks**: False positive — transfers go to `msg.sender` (intended recipient)

---

## System Architecture

### Components

| Component | Purpose | Security Features |
|-----------|---------|-------------------|
| `Counter` | Test contract | N/A (out of scope) |
| `PrizeVault` | ERC-20 vault | None (no access control, no reentrancy guard, no SafeERC20) |
| `TicketPrizePool` | v1 lottery | Commit-reveal entropy, but no owner/emergency/recommit |
| `TicketPrizePoolShmon` | v2 lottery | Multi-round, overlapping, but no owner/emergency/reentrancy guard |
| `TicketPrizePoolShmonShMonad` | v3 production | Owner, pause, nonReentrant, executeNext, recommit, emergencyForceSettle |

### Trust Boundaries

- **External staking contracts** (IStaker, IShmonadStaker, IShMonad): Trusted for correct deposit/unstake behavior. ShMonad failure triggers cascading loss (H-02).
- **Owner role** (production only): Pause/unpause, emergency force-settle (after 14-day timeout), ownership transfer. Acts in good faith but emergency path causes total loss (C-03).
- **Blockhash**: Validators have influence over randomness (C-01).
- **Round progression**: Permissionless — anyone can call `commitDraw`, `drawWinner`, `settleRound`, `executeNext`.

### Value Flow

```
User --[MON]--> buyTickets() --[MON]--> shMON.deposit()
                                            |
                                      [shMON shares]
                                            |
drawWinner() --> shMON.requestUnstake() ----+
                                            |
settleRound() --> shMON.completeUnstake() --+--> [MON back]
                                            |
                              yield = received - principal
                                            |
                         +------------------+------------------+
                         |                                     |
                    claimPrize()                      withdrawPrincipal()
                    [yield to winner]                 [principal * lossRatio to user]
```

---

## Protocol Invariants

| ID | Invariant | Status |
|----|-----------|--------|
| INV-001 | PrizeVault `totalDeposits` == sum of `balances[user]` | **Violated by C-02** (unchecked transfers) |
| INV-002 | PrizeVault `asset.balanceOf(vault) >= totalDeposits` | **Violated by C-02, M-01** |
| INV-003 | `roundPrincipal[rid]` == sum of `principalOf[rid][user]` | Maintained |
| INV-004 | Post-finalization solvency (contract holds enough for refunds + prize) | **Violated by H-01** (totalUnderlying inflation) |
| INV-005 | `totalTickets == ranges[last].end` | Maintained |
| INV-006 | Ticket ranges contiguous, non-overlapping | Maintained (L-04 invalidated) |
| INV-007 | Round state monotonic (Open -> Committed -> Finalizing -> Settled) | Maintained |
| INV-008 | Users can always withdraw principal after settlement | **Violated by C-03, C-04, M-03, M-04** |
| INV-009 | Single active finalizer | Maintained |
| INV-010 | Prize claimed once, only by winner | Maintained |
| INV-011 | Principal withdrawn once | Maintained |
| INV-012 | Winning ticket < totalTickets | Maintained |
| INV-013 | Randomness not controllable by ticket purchasers | **Violated by C-01** |
| INV-014 | Unchecked transfers must not desync PrizeVault state | **Violated by C-02** |
| INV-015 | shMON shares staked == actual shares held | Maintained |
| INV-016 | Emergency force settle only after 14-day timeout | Maintained (but outcome violates INV-008) |

---

## Remediation Roadmap

### Immediate Priority (Production Contract)

| # | Finding | Fix | Effort |
|---|---------|-----|--------|
| 1 | C-01: Blockhash PRNG | Integrate VRF (Chainlink/Pyth) or add recommit limits + entropy mix | High |
| 2 | C-03: emergencyForceSettle lossRatio=0 | Change to `lossRatio = 1e18`; add try-catch + recovery function | Medium |
| 3 | H-02: ShMonad failure cascade | Add try-catch in `_settleRound`; add post-settlement recovery function | Medium |

### High Priority (Legacy Contracts)

| # | Finding | Fix | Effort |
|---|---------|-----|--------|
| 4 | C-04: TicketPrizePoolShmon no escape | Add emergency settle or deprecate with warnings | Medium |
| 5 | C-02: PrizeVault unchecked transfers | Use SafeERC20 | Low |
| 6 | H-01: totalUnderlying inflation | Use balance-delta pattern | Low |

### Medium Priority

| # | Finding | Fix | Effort |
|---|---------|-----|--------|
| 7 | M-02: claimUnstake trust boundary | Use balance-delta verification | Low |
| 8 | M-03: Staker insolvency blocks finalization | Add lossRatio mechanism | Medium |
| 9 | M-04: Blockhash window expiry | Add recommit function | Low |
| 10 | M-05: Missing overflow check | Backport from production | Low |

### Low Priority (Defense-in-Depth)

| # | Finding | Fix | Effort |
|---|---------|-----|--------|
| 11 | L-01/L-02: Missing reentrancy guards | Add `nonReentrant` | Low |
| 12 | L-05: executeNext nonReentrant gap | Add `nonReentrant` | Low |
| 13 | L-03: PrizeVault CEI violation | Reorder or add guard | Low |

---

*This report was generated using automated security analysis tools (Slither, Aderyn) and manual code review with Devil's Advocate verification. Foundry proof-of-concept exploits were developed for 6 findings. All PoC files are available in `.sc-auditor-work/pocs/`.*
