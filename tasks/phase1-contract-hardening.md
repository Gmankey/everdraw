# Phase 1: Contract Hardening — Task Sheet

**Date:** 2026-02-28
**Owner:** ChatGPT
**PM:** Claude (Opus)
**Target:** `src/TicketPrizePoolShmonShMonad.sol`
**Goal:** Make the contract mainnet-ready with emergency controls, defense-in-depth, and stuck-round recovery.

---

## Context

The contract is being deployed to Monad mainnet as a no-loss lottery using ShMonad yield. Current contract works but has no admin controls, no reentrancy guard, and no recovery path for stuck rounds. All changes go into `TicketPrizePoolShmonShMonad.sol` directly.

**Mainnet deploy parameters:**
- Ticket price: 0.1 MON
- Commit delay: 10 blocks
- Round duration: 7 days (604800 sec)
- No protocol fee

---

## Task 1.1: Add Ownable + Pausable

### What to add

An `owner` address (set at deploy in constructor) with the ability to pause and unpause.

### Behavior when paused

| Function | Paused behavior |
|----------|----------------|
| `buyTickets()` | REVERTS — no new deposits |
| `executeNext()` (both overloads) | REVERTS — no round progression |
| `commitDraw()` | REVERTS |
| `skipRound()` | REVERTS |
| `drawWinner()` | REVERTS |
| `settleRound()` | REVERTS — EXCEPT see note below |
| `claimPrize()` | ALLOWED — users must always be able to claim winnings |
| `withdrawPrincipal()` | ALLOWED — users must always be able to withdraw |
| View functions | ALLOWED |

**Critical exception:** If a round is in `Finalizing` state when paused, `settleRound()` must still be callable. Otherwise funds are permanently locked. Implement as: `settleRound()` is allowed when paused ONLY if the round is the `activeFinalizingRoundId`. This completes the unstake and makes funds claimable.

### Implementation

Do NOT import OpenZeppelin (minimize dependencies for a fresh Foundry project). Implement inline:

```solidity
address public owner;
bool public paused;

modifier onlyOwner() {
    require(msg.sender == owner, "not owner");
    _;
}

modifier whenNotPaused() {
    require(!paused, "paused");
    _;
}

function pause() external onlyOwner {
    paused = true;
    emit Paused(msg.sender);
}

function unpause() external onlyOwner {
    paused = false;
    emit Unpaused(msg.sender);
}

event Paused(address indexed by);
event Unpaused(address indexed by);
```

Add `owner = msg.sender;` to the constructor.

Add `whenNotPaused` modifier to: `buyTickets`, `commitDraw`, `skipRound`, `drawWinner`, both `executeNext` overloads.

For `settleRound`: do NOT add `whenNotPaused`. Instead add a custom check:

```solidity
function settleRound(uint256 rid) external {
    // Allow settling even when paused IF this is the active finalizer
    // (prevents permanent fund lock)
    if (paused && activeFinalizingRoundId != rid) revert BadState();
    // ... rest of existing logic
}
```

### Transfer ownership

Add a two-step ownership transfer (prevent accidental transfers to wrong address):

```solidity
address public pendingOwner;

function transferOwnership(address newOwner) external onlyOwner {
    pendingOwner = newOwner;
}

function acceptOwnership() external {
    require(msg.sender == pendingOwner, "not pending owner");
    owner = pendingOwner;
    pendingOwner = address(0);
    emit OwnershipTransferred(msg.sender);
}

event OwnershipTransferred(address indexed newOwner);
```

---

## Task 1.2: Add ReentrancyGuard

### What to add

A simple reentrancy lock. Do NOT import OpenZeppelin — implement inline:

```solidity
uint256 private _locked = 1;

modifier nonReentrant() {
    require(_locked == 1, "reentrant");
    _locked = 2;
    _;
    _locked = 1;
}
```

### Where to apply

Add `nonReentrant` to:
- `buyTickets()` — sends MON to ShMonad (external call)
- `claimPrize()` — sends MON to winner (external call)
- `withdrawPrincipal()` — sends MON to user (external call)
- `_settleRound()` — calls `completeUnstake()` on ShMonad (external call)
- `_drawWinner()` — calls `requestUnstake()` on ShMonad (external call)

---

## Task 1.3: Add uint32 ticket overflow check

### What to add

In `buyTickets()`, after computing the new ticket range:

```solidity
uint32 start = r.totalTickets;
// ADD THIS CHECK:
require(uint256(start) + uint256(ticketCount) <= type(uint32).max, "ticket overflow");
uint32 end = start + ticketCount;
```

This prevents a hypothetical overflow where `totalTickets` wraps around, breaking the range-based ownership lookup.

---

## Task 1.4: Blockhash expiry recovery

### Problem

If nobody calls `drawWinner()` within 256 blocks of `targetBlockNumber`, `blockhash()` returns 0 and the round is permanently stuck in `Committed` state. All deposited funds are locked.

### Solution: Allow re-commit

Add a function that allows re-committing a round if the blockhash window has expired:

```solidity
function recommit(uint256 rid) external whenNotPaused {
    RoundData storage r = rounds[rid];
    if (r.state != RoundState.Committed) revert BadState();
    if (block.number <= r.targetBlockNumber + 255) revert TooEarly(); // window not expired yet

    // Reset to new target block
    r.targetBlockNumber = block.number + commitDelayBlocks;
    emit DrawCommitted(rid, r.targetBlockNumber);
}
```

This is permissionless — anyone can call it. It simply sets a new target block, giving another 256-block window to draw.

Also add `NextAction.Recommit` to the automation path (explicit enum + execute wiring):

```solidity
enum NextAction {
    None,
    Commit,
    Skip,
    Draw,
    Settle,
    Recommit
}

// In nextAction():
if (
    r.state == RoundState.Committed &&
    block.number > r.targetBlockNumber + 255 &&
    r.totalTickets > 0
) return NextAction.Recommit;

// In _execute():
if (a == NextAction.Recommit) {
    recommit(rid);
    return true;
}
```

---

## Task 1.5: Finalization timeout

### Problem

If `completeUnstake()` permanently reverts (ShMonad bug), the round stays in `Finalizing` forever. `activeFinalizingRoundId` is never cleared. No future rounds can draw winners. All future deposited funds are locked.

### Solution: Emergency force-settle (owner only)

```solidity
uint256 public constant FINALIZATION_TIMEOUT = 14 days;

function emergencyForceSettle(uint256 rid) external onlyOwner {
    RoundData storage r = rounds[rid];
    if (r.state != RoundState.Finalizing) revert BadState();
    if (activeFinalizingRoundId != rid) revert BadState();

    // Only allow after timeout period
    // We need to store when finalization started. Add a new field:
    // uint64 finalizationStartTime; (set in _drawWinner)
    require(block.timestamp >= r.finalizationStartTime + FINALIZATION_TIMEOUT, "timeout not reached");

    // Force settle: treat as total loss of the staked amount
    // (conservatively assume ShMonad returned nothing)
    r.monReceived = 0;
    r.yieldMON = 0;
    r.lossRatio = 0; // total loss — but see note below
    r.state = RoundState.Settled;
    activeFinalizingRoundId = 0;

    emit RoundSettled(rid, 0, 0, 0);
    _bumpCursor();
}
```

**NOTE:** Setting `lossRatio = 0` means all principal withdrawals will return 0. This is the worst case — funds are lost in ShMonad. If the contract actually holds MON from a partial unstake, the owner could send MON to the contract manually and set a more accurate `lossRatio`. But for the emergency path, 0 is the safest default (don't promise money that might not exist).

**Add to RoundData struct:**
```solidity
uint64 finalizationStartTime; // set when entering Finalizing state
```

Set it in `_drawWinner()`:
```solidity
r.finalizationStartTime = uint64(block.timestamp);
```

---

## Task 1.6: Legacy code handling (Phase 1 = keep legacy revert)

### Keep legacy revert mechanism in Phase 1 (PM decision)

The `_legacyRevert`, `revertBytes`, `LEGACY_ERR_SELECTOR`, and `legacyBytes` paths are still referenced by existing tests (`EmptyRound`, `FinalizationBusy`) via legacy wrapper calls and legacy revert assertions.

**Phase 1 rule:** keep legacy revert behavior intact.

What to do in Phase 1:
- Keep legacy wrappers (`commitDraw(rid)`, `skipRound(rid)`, `drawWinner(rid)`, `settleRound(rid)`) and their legacy revert format unchanged
- Add new hardening modifiers/checks around those wrappers where applicable (`whenNotPaused`, pause exception for settle active finalizer, etc.)
- Do not force test migration in this phase

What to do in Phase 2:
- Port tests to custom errors/hardened surface
- Remove legacy revert machinery and simplify wrappers

### Important sequencing constraint

Do **not** delete legacy contracts/tests in Phase 1. Keep repo cleanup out of hardening so we can:
1. Harden contract first
2. Port tests against hardened contract
3. Remove obsolete files only after parity is confirmed

This avoids losing useful references during test migration.

---

## Task 1.7: Update deploy script

Update `script/DeployTicketPrizePoolShmonShMonad.s.sol` with mainnet parameters:

```solidity
TicketPrizePoolShmonShMonad pool = new TicketPrizePoolShmonShMonad(
    0.1 ether,   // ticket price: 0.1 MON
    10,          // commit delay: 10 blocks
    604800,      // round duration: 7 days
    shmon        // ShMonad address from env
);
```

---

## Acceptance criteria

1. Contract compiles with `forge build` (no errors or warnings).
2. Existing `EmptyRound` and `FinalizationBusy` tests pass (update if needed for new modifiers).
3. `owner` is set to `msg.sender` at deploy.
4. `pause()` / `unpause()` work correctly — paused blocks `buyTickets` and progression, allows claims and withdrawals.
5. `settleRound()` works when paused if round is the active finalizer.
6. `nonReentrant` is on all external-call functions.
7. `recommit()` works when blockhash window has expired.
8. `emergencyForceSettle()` works after timeout, clears `activeFinalizingRoundId`.
9. Legacy revert behavior remains intact in Phase 1; tests depending on legacy format continue to pass.
10. Deploy script has mainnet parameters.
11. Legacy file deletion is explicitly deferred until after Phase 2 parity.

---

## Files to create/modify

| Action | File |
|--------|------|
| MODIFY | `src/TicketPrizePoolShmonShMonad.sol` (all hardening changes) |
| MODIFY | `script/DeployTicketPrizePoolShmonShMonad.s.sol` (mainnet params) |
| MODIFY | `test/TicketPrizePoolShmonShMonad.EmptyRound.t.sol` (update for new modifiers if needed) |
| MODIFY | `test/TicketPrizePoolShmonShMonad.FinalizationBusy.t.sol` (update for new modifiers if needed) |
| NOTE | Destructive cleanup/deletions moved to later phase after test parity is confirmed. |
