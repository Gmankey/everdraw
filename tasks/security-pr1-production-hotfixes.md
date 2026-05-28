# PR 1 — Production Contract Security Hotfixes

**Status:** Urgent, blocks Phase 2 mainnet
**Target contract:** `src/TicketPrizePoolShmonShMonad.sol` (production v3)
**Source:** `security_audit/AUDIT_REPORT_2026-04-08_v1-era.md` findings C-01, C-03, H-02
**Owner:** Builder → PM review before deploy
**Target effort:** 2 days build + 1 day testing

---

## Pre-work: pause decision

Before starting this PR, PM will separately call `pause()` on the live production contract on Monad mainnet. Confirm pause is active before deploying this PR. Do not unpause until PR 1 is merged, tested, and redeployed.

---

## Fix 1 — C-01 stopgap: cap recommits + restrict drawWinner/recommit to keeper

**Why:** Blockhash-based randomness is predictable once the target block is mined. Combined with permissionless unlimited `recommit()`, an attacker can reroll the winner until they win. Full VRF integration is PR 3. This PR adds enough friction to make the attack uneconomical in the interim.

### Changes

1. **Add a keeper allowlist**
   ```solidity
   mapping(address => bool) public isKeeper;
   event KeeperSet(address indexed keeper, bool allowed);

   modifier onlyKeeper() {
       if (!isKeeper[msg.sender]) revert NotKeeper();
       _;
   }

   function setKeeper(address keeper, bool allowed) external onlyOwner {
       isKeeper[keeper] = allowed;
       emit KeeperSet(keeper, allowed);
   }
   ```
   Add `error NotKeeper();` to the errors block.

2. **Add a per-round recommit counter with hard cap**
   ```solidity
   uint8 public constant MAX_RECOMMITS_PER_ROUND = 3;
   // Add to the Round struct:
   //   uint8 recommitCount;
   ```
   The struct field must be added in a way that does not break existing storage layout if this contract is ever upgraded (it is not upgradeable today, so appending to the struct is safe — but document this in a comment).

3. **Gate `drawWinner` and `recommit` behind `onlyKeeper`**
   - Add `onlyKeeper` modifier to `drawWinner(uint64 rid)`
   - Add `onlyKeeper` modifier to `recommit(uint64 rid)`
   - Add `onlyKeeper` modifier to `executeNext()` — since it can internally trigger a draw, it must be gated too

4. **Enforce recommit cap inside `_recommit`**
   ```solidity
   function _recommit(uint64 rid) internal {
       Round storage r = rounds[rid];
       if (r.recommitCount >= MAX_RECOMMITS_PER_ROUND) revert RecommitLimitReached();
       r.recommitCount += 1;
       r.targetBlockNumber = uint64(block.number + 1);
       r.state = RoundState.Committed;
       emit Recommitted(rid, r.recommitCount, r.targetBlockNumber);
   }
   ```
   Add `error RecommitLimitReached();` and update the `Recommitted` event signature.

5. **Re-introduce an entropy mix in `_drawWinner`**
   Mix in additional values the attacker cannot freely control:
   ```solidity
   bytes32 rnd = keccak256(abi.encodePacked(
       blockhash(r.targetBlockNumber),
       rid,
       r.totalPrincipalMON,
       r.totalTickets,
       block.prevrandao
   ));
   ```
   `block.prevrandao` is post-Merge randomness. On Monad it may or may not be meaningful — verify behavior on Monad explorer before relying on it. If `prevrandao` is zero on Monad, document that and note that the real fix is PR 3 (Pyth Entropy). This stopgap is defense-in-depth only.

### Acceptance criteria

- Non-keeper address calling `drawWinner` reverts with `NotKeeper`
- Non-keeper address calling `recommit` reverts with `NotKeeper`
- Non-keeper address calling `executeNext` reverts with `NotKeeper`
- Owner can add/remove keepers via `setKeeper`
- Fourth call to `_recommit` on the same round reverts with `RecommitLimitReached`
- `recommitCount` resets to 0 for each new round
- All existing tests still pass

### Foundry tests to write

- `test_drawWinner_rejectsNonKeeper`
- `test_recommit_rejectsNonKeeper`
- `test_executeNext_rejectsNonKeeper`
- `test_owner_canAddKeeper`
- `test_owner_canRemoveKeeper`
- `test_recommit_revertsAtFourthAttempt`
- `test_recommitCount_resetsPerRound`
- `test_drawWinner_stillWorksForKeeper` (regression)

---

## Fix 2 — C-03: emergencyForceSettle lossRatio bug

**Why:** Setting `lossRatio = 0` causes all users to withdraw zero MON, violating the no-loss guarantee. Must be `1e18` (full principal return) as the safe default.

### Changes

In `emergencyForceSettle(uint64 rid)`:

```solidity
// BEFORE:
r.monReceived = 0;
r.yieldMON = 0;
r.lossRatio = 0;
r.state = RoundState.Settled;

// AFTER:
// Try to complete the unstake one more time — if shMON has recovered,
// we can settle normally and nobody loses anything.
uint256 balBefore = address(this).balance;
try shmon.completeUnstake() {
    uint256 received = address(this).balance - balBefore;
    r.monReceived = received;
    if (received >= r.totalPrincipalMON) {
        r.yieldMON = received - r.totalPrincipalMON;
        r.lossRatio = 1e18;
    } else {
        r.yieldMON = 0;
        // Partial loss — scale principal proportionally
        r.lossRatio = (received * 1e18) / r.totalPrincipalMON;
    }
} catch {
    // shMON still broken. Make users whole from contract balance.
    // lossRatio = 1e18 means users withdraw their full principal from
    // whatever MON the contract currently holds. If the contract later
    // recovers the shMON shares, use recoverStrandedShares().
    r.monReceived = 0;
    r.yieldMON = 0;
    r.lossRatio = 1e18;  // ← key fix: full principal, not zero
}
r.state = RoundState.Settled;
emit EmergencyForceSettled(rid, r.monReceived, r.lossRatio);
```

Update the `EmergencyForceSettled` event to include `monReceived` and `lossRatio`.

### Acceptance criteria

- emergencyForceSettle with working shMON → users withdraw full principal + yield
- emergencyForceSettle with broken shMON → users withdraw full principal from contract balance
- emergencyForceSettle with partial shMON recovery → users withdraw proportional amount
- In all cases, `lossRatio` is never `0` unless `totalPrincipalMON` was 0
- Round state is `Settled` after the call (no regression)

### Foundry tests to write

- `test_emergencyForceSettle_shmonWorks_usersGetFullPrincipalPlusYield`
- `test_emergencyForceSettle_shmonBroken_usersGetFullPrincipal`
- `test_emergencyForceSettle_shmonPartial_usersGetProportional`
- `test_emergencyForceSettle_neverZeroLossRatio` (property test)
- Port the existing PoC `test_exploit_HS004_emergencyForceSettle_zeroes_principal` and assert it now FAILS to reproduce (i.e. users no longer get zero)

---

## Fix 3 — H-02: try-catch in _settleRound + recovery function

**Why:** A single shMON `completeUnstake` failure currently cascades into a 14-day DoS for the entire protocol because `activeFinalizingRoundId` stays non-zero. Add a retry path and a post-settlement recovery function so transient failures don't trigger the emergency path at all.

### Changes

1. **Try-catch in `_settleRound` for transient failures**
   ```solidity
   uint256 balBefore = address(this).balance;
   try shmon.completeUnstake() {
       uint256 received = address(this).balance - balBefore;
       // ... normal settlement ...
   } catch {
       // Leave round in Finalizing. Do not advance activeFinalizingRoundId yet.
       // A keeper can retry settleRound later, or emergencyForceSettle after timeout.
       emit SettlementRetryNeeded(rid);
       return;
   }
   ```
   Add `event SettlementRetryNeeded(uint64 indexed rid);`

2. **Add `recoverStrandedShares` function**
   ```solidity
   /// @notice Recover shMON that became claimable AFTER a round was emergency-settled.
   /// Sweeps any completeUnstake output into the contract balance, then allows
   /// affected users to claim pro-rata against their original principal.
   mapping(uint64 => uint256) public recoveredMON;          // rid => recovered MON
   mapping(uint64 => mapping(address => bool)) public recoveryClaimed;

   event SharesRecovered(uint64 indexed rid, uint256 amount);
   event RecoveryClaimed(uint64 indexed rid, address indexed user, uint256 amount);

   error RoundNotEmergencySettled();
   error NothingToRecover();
   error AlreadyClaimedRecovery();

   function recoverStrandedShares(uint64 rid) external onlyOwner nonReentrant {
       Round storage r = rounds[rid];
       if (r.state != RoundState.Settled) revert RoundNotEmergencySettled();
       // Only rounds that went through the catch branch of emergencyForceSettle
       // should be eligible — monReceived == 0 is the marker.
       if (r.monReceived != 0) revert RoundNotEmergencySettled();

       uint256 balBefore = address(this).balance;
       shmon.completeUnstake();  // if this reverts, the whole tx reverts — caller retries later
       uint256 received = address(this).balance - balBefore;
       if (received == 0) revert NothingToRecover();

       recoveredMON[rid] += received;
       emit SharesRecovered(rid, received);
   }

   function claimRecovery(uint64 rid) external nonReentrant {
       Round storage r = rounds[rid];
       if (recoveryClaimed[rid][msg.sender]) revert AlreadyClaimedRecovery();
       uint256 userPrincipal = principalOf[rid][msg.sender];
       if (userPrincipal == 0) revert NothingToRecover();

       uint256 share = (recoveredMON[rid] * userPrincipal) / r.totalPrincipalMON;
       if (share == 0) revert NothingToRecover();

       recoveryClaimed[rid][msg.sender] = true;
       (bool ok, ) = msg.sender.call{value: share}("");
       require(ok, "transfer failed");
       emit RecoveryClaimed(rid, msg.sender, share);
   }
   ```

   **Important:** `principalOf[rid][user]` is currently zeroed by `withdrawPrincipal`. We need to NOT zero it in the emergency-settle-then-recover flow. Two options:
   - **Option A (cleaner):** track a separate `recoveryPrincipalOf[rid][user]` snapshot taken at emergency force settle time
   - **Option B (simpler):** zero `principalOf` on recovery claim instead of on withdrawPrincipal, and track `withdrawnPrincipal[rid][user]` separately

   Go with Option A. Snapshot user principals into `recoveryPrincipalOf` inside `emergencyForceSettle` only when the catch branch fires:
   ```solidity
   // In the catch branch:
   // Note: we don't iterate users here (too expensive). Instead, change claimRecovery
   // to read principalOf directly and track recoveryClaimed as the de-dup guard.
   // principalOf is zeroed by withdrawPrincipal, so users who already withdrew their
   // principal get nothing extra from recovery — which is correct, they already got made whole
   // from contract balance via the lossRatio=1e18 fix.
   ```

   **Revised design:** no snapshot needed. `claimRecovery` reads `principalOf[rid][user]` directly. Users who already called `withdrawPrincipal` have `principalOf == 0` and get nothing from recovery (correct — they already received MON from contract balance). Users who haven't withdrawn yet can either withdraw OR claim recovery. Claiming recovery zeros their `principalOf` to prevent double-dip. Update `withdrawPrincipal` to also check `recoveryClaimed` to prevent the reverse double-dip.

   This is cleaner. Go with this.

### Acceptance criteria

- `_settleRound` transient failure → emits `SettlementRetryNeeded`, round stays in Finalizing, keeper can retry
- `_settleRound` transient failure does NOT advance `activeFinalizingRoundId` prematurely
- After `emergencyForceSettle` catch branch, users can `withdrawPrincipal` and get their full principal from contract balance
- After `emergencyForceSettle` catch branch and later shMON recovery, owner can call `recoverStrandedShares`
- Users who already withdrew get nothing from recovery
- Users who haven't withdrawn can claim recovery OR withdraw principal, but not both
- Double-claim in any direction reverts

### Foundry tests to write

- `test_settleRound_transientFailure_roundStaysFinalizing`
- `test_settleRound_retry_afterTransientFailure_succeeds`
- `test_recoverStrandedShares_ownerCanCallAfterEmergency`
- `test_recoverStrandedShares_sweepsToContract`
- `test_claimRecovery_userGetsProRata`
- `test_claimRecovery_doubleClaimReverts`
- `test_withdrawPrincipal_afterRecoveryClaim_reverts`
- `test_claimRecovery_afterWithdrawPrincipal_reverts` (the other direction)
- Port PoC `test_exploit_HS008_no_recovery_after_emergency_settle` and assert it now passes (funds are recoverable)

---

## Deployment checklist

After the PR merges:

1. Run the full test suite including old PoC tests (many should now fail to reproduce — that's the win condition)
2. Deploy to a Monad testnet address
3. Run a manual round end-to-end on testnet with the new keeper gate
4. Verify `pause()` / `unpause()` still work
5. PM review + sign-off
6. Deploy to mainnet at the same address if possible (will require a migration — discuss with PM)
7. Owner calls `setKeeper(keeperAddress, true)` immediately after deploy
8. PM unpauses the contract
9. Announce fix in user-facing channel

---

## Out of scope for PR 1

- Full VRF integration (Pyth Entropy) — that's PR 3 (Phase 2a V2 contract)
- Per-user share tracking for exact loss ratios — design tradeoff DT-02, accepted
- Legacy contract fixes — that's PR 2
- PrizeVault SafeERC20 — PR 2 recommends deletion instead
