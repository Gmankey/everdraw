# EverDraw Feature-Parity Acceptance Checklist

**Purpose:** the single authoritative list of *everything the protocol is supposed to do*, reconciled against what the deployed contract actually does. This exists because crucial **features** (not bugs) repeatedly slipped through correctness-only reviews — most visibly the Merkl-readable surface dropped between V2→V3, and **shMON deposits dropped between V2→V3 and never restored in V4**. A clean security audit of the wrong feature set is worthless.

**This is a reusable gate, not a one-off.** Before any contract redeploy is declared "done," every ✅ row below must be **re-verified against the new contract** (on-chain `cast call` or a passing test), and no ❌ row may remain unless explicitly accepted-and-recorded by the operator. See "How to use this gate" at the bottom.

**Legend:** ✅ present & verified · ➕ new in V4 (improvement) · ⚠️ changed from prior version — confirm no downstream breakage · ❌ **MISSING — regression**

**Sources:** V2 = `TicketPrizePoolShmonV2` (most feature-complete prior version) · ADR = decision records · Vision = `docs-site/pages/vision` · Intent = operator's stated requirements.

---

## 1. Deposit / entry

| Capability | Source | V4 status | Verify |
|---|---|---|---|
| Deposit native MON to buy tickets | V2 `buyTicketsMON` | ✅ `buyTickets` (Native mode) | `cast` buy sim |
| **Deposit shMON directly (hold shMON → enter without unstaking)** | V2 `buyTicketsShmon`, Intent | ❌ **MISSING** | — |
| ERC-20 deposit mode (future non-MON vaults) | ADR-0024 §4 | ➕ present (unused) | `depositMode()` |
| Per-vault ticket price | V2 | ✅ | `ticketPriceAsset()` |
| Mutable ticket price (bounded, per-round snapshot) | ADR-0024 §6 | ➕ `setTicketPrice` | view + event |
| Multiple buys in one round accumulate | V2 | ✅ | `getUserPosition` |

## 2. Prize / draw

| Capability | Source | V4 status | Verify |
|---|---|---|---|
| Prize funded by yield only (never principal) | V2, no-loss invariant | ✅ | settlement math |
| Single winner | V2 | ✅ (numWinners=1) | `numWinners()` |
| Multiple winners with fixed allocation | ADR-0025 | ➕ | `getRoundWinners` |
| Verifiable randomness (Pyth Entropy) | ADR-0014/0029 | ✅ | `randomnessOracle()` |
| Forfeit-to-depositors when tickets < positions | ADR-0025 | ➕ | `forfeitBps` |
| Sponsor a round's prize pool | ADR-0026 | ➕ `sponsor` | event |
| Sponsor refund on skipped/force-settled round | ADR-0026 | ➕ `claimSponsorRefund` | — |

## 3. Withdraw / claim

| Capability | Source | V4 status | Verify |
|---|---|---|---|
| Withdraw full principal (no-loss) | V2 | ✅ `withdrawPrincipal` | on-chain |
| Claim prize (winner) | V2 | ✅ `claimPrize` | on-chain |
| **View of withdrawable amount before withdrawing** | V2 `getWithdrawableShares` | ❌ **MISSING** (minor) | — |
| No expiry on claims or withdrawals | V2 | ✅ | by design |
| Deferred-claim retry if a payout transfer fails | ADR-0028 | ➕ `claimDeferred` / `hasPendingClaims` | — |
| Withdraw returns shMON shares (re-enter without unstake) | V2 | ✅ | — |
| Frontend: "withdraw & convert to MON" (→ shmonad) | UX | ✅ (frontend) | app |

## 4. No-loss / accounting

| Capability | Source | V4 status | Verify |
|---|---|---|---|
| Principal always returned, win or lose | core thesis | ✅ | invariant proof (audit §4) |
| Principal tracked separately from prize | V2 | ✅ | state layout |
| Per-user, per-round accounting | V2 | ✅ | `getUserPosition` |

## 5. Cadence / multi-vault

| Capability | Source | V4 status | Verify |
|---|---|---|---|
| Round = deposit window → lock → draw → repeat | V2/ADR-0002 | ✅ | round states |
| Next round opens automatically on settle | V2 | ✅ | `RoundStarted` |
| Multiple vaults, **3.5-day stagger** | ADR-0001/0010 | ✅ **now enforced in deploy script** (`STAGGER_REFERENCE_VAULT`) | guard aborts mis-stagger |

## 6. Fees

| Capability | Source | V4 status | Verify |
|---|---|---|---|
| Protocol fee on yield (optional) | ADR-0020 | ✅ | `feeAllocationsLength` |
| Multi-recipient fee router | ADR-0027 | ➕ `setFeeAllocations` | — |
| Fee capped (20%), summed across recipients | ADR-0027 | ✅ `MAX_TOTAL_FEE_BPS` | constant |
| Per-round fee snapshot (no retroactive change) | ADR-0020 | ✅ | `getRoundFeeAllocation` |

## 7. Governance / admin

| Capability | Source | V4 status | Verify |
|---|---|---|---|
| Two-step ownership transfer | V2/V3 | ✅ | `pendingOwner` |
| **Separate pauser role (not owner)** | ADR-0024 §8 | ➕ `setPauser` | `pauser()` |
| Keeper authorization | V2 | ✅ `setKeeper` | `isKeeper` |
| Pause (blocks new deposits only) | V2 | ✅ | `paused()` |
| Graceful `stop()` (one-way retirement) | ADR-0024 §5 | ➕ | `stoppedAt()` |
| Randomness oracle swap with 24h timelock | ADR-0029 | ➕ | `queue/commitOracleChange` |
| VRF reserve deposit/withdraw | V3 | ✅ | balance |
| `emergencyForceSettle` (stuck-round recovery) | V3 | ✅ | — |
| Per-round campaign metadata | V3 | ✅ `setNextRoundMetadata` | — |

## 8. Integrations / surfaces

| Capability | Source | V4 status | Verify |
|---|---|---|---|
| Merkl-readable position surface (`balanceOf`/`totalSupply`/`name`/`symbol`/`decimals`/`Deposit`/`Withdraw`) | ADR-0006 (the V3 miss) | ✅ | `cast` reads |
| Non-transferable position (no transfer/approve/allowance) | ADR-0006 | ✅ | reverts |
| Position name/symbol | V2: "EverDraw shMON Position" / "EVRDRAW-SHMON" | ⚠️ **changed** to "EverDraw Position" / "EVRDRAW-A·B" — confirm shMonad points keying is by address (it is), not symbol | — |
| Self-describing metadata views (`asset`/`depositMode`/`yieldVault`/`assetSymbol`) | ADR-0024 §7 | ➕ | views |
| shMonad points (via Merkl surface) | Intent | ✅ | Merkl |
| EverDraw points (off-chain) | ADR-0008 | ✅ (indexer) | indexer |
| Indexer coverage of all V4 events | ADR (indexer ticket) | ✅ (confirm after each event change) | indexer health |

## 9. Liveness / safety

| Capability | Source | V4 status | Verify |
|---|---|---|---|
| Permissionless cranking (keeper not required) | V2 | ✅ | public fns |
| Reentrancy guards on all fund paths | audit | ✅ (audit §4; L-1 minor on `commitDraw`/`skipRound`) | audit |
| Randomness timeout → force-settle, no stuck rounds | ADR-0015 | ✅ | `VRF_CALLBACK_TIMEOUT` |
| Non-upgradeable, non-custodial | ADR-0017 | ✅ | no proxy |

---

## Confirmed gaps vs. the intended feature set (the punch-list)

1. **shMON direct deposit — MISSING. CRUCIAL.** V2 had `buyTicketsShmon`; V3 stubbed it (`revert`); V4 inherited the gap. Requires a contract change (vault accepts shMON shares directly, crediting principal at the share rate, mirroring V2) + redeploy. There is no non-redeploy workaround (shMON→MON needs the slow unstaking queue).
2. **`getWithdrawableShares` view — MISSING. Minor.** Convenience view for "what will I get on withdraw." Cheap to add in the same revision.
3. **Position name/symbol changed from V2 — cosmetic.** Confirm shMonad's points / Merkl indexing keys by **address** (it does), so this is informational, not a regression. No action unless an integrator keys on symbol.

**Everything else V2 did, V4 does — most of it improved.** This is the complete reconciliation; the external function surface was fully enumerated (no third crucial deposit/withdrawal feature is hiding).

---

## How to use this gate (every redeploy)

1. **Before specifying a redeploy:** read this checklist top to bottom. Any new requirement → add a row first.
2. **Before declaring a deploy done:** re-verify **every ✅ row** against the *new* contract — on-chain `cast call` or a passing test. A row is not green because it was green last time; it's green because it was checked on the new bytecode.
3. **No ❌ ships silently.** A missing capability either gets fixed in that revision or is explicitly accepted-and-recorded by the operator (with the reason) in this file.
4. **Update on every contract change.** New functions/events/removals update the relevant rows in the same PR.
5. This checklist is referenced by the deploy runbook and is part of the multi-surface discipline (`process/multi-surface-impact-checklist.md`).

The point: stop relying on memory to hold the feature set. The list holds it; the deploy is gated on the list.
