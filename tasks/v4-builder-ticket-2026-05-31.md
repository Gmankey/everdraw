# Builder Ticket — V4 Contract Implementation

**Implements:** ADRs 0024 (V4 spec), 0025 (multi-winner), 0026 (sponsor drop-in), 0027 (fee router), 0028 (transfer resilience), 0029 (randomness oracle)
**Target:** New contract `src/TicketPrizePoolV4.sol`, new adapter `src/PythRandomnessOracle.sol`
**Deadline:** 5 days from spec hand-off. Internal audit only, no external firm. Operator accepts the time/audit trade.
**Branch:** create `feat/v4-contract` off `staging`
**PR target:** `staging`

---

## Why this exists

V3 was deployed without the Merkl-readable position surface required by ADR-0006. Without that surface, Merkl cannot integrate V3 vaults. V3 contracts are immutable. Therefore we need V4.

Since V4 requires a fresh deploy + audit cycle regardless, we are packing **every accumulated design debt** into V4 in this single redeploy. Spec is comprehensive on purpose. **Do not try to ship a minimum-viable subset.** Implement every Tier 1 + Tier 2 item from ADR-0024 §1-12. Items Tier 4 (factory, pause hub, MegaDraw) are explicitly out of scope and stay deferred.

---

## What to build, in order

### Day 1 — Skeleton + Merkl surface + generic asset

1. **Create `src/TicketPrizePoolV4.sol`** — start from `src/TicketPrizePoolShmonV3.sol` as the structural base, then refactor:
   - Rename `IShMonad` → `IYieldVault`, update interface to ERC-4626-compatible: `deposit(uint256,address)`, `previewDeposit(uint256)`, `previewRedeem(uint256)`, `transfer(address,uint256)`, `balanceOf(address)`
   - Add `enum DepositMode { Native, ERC20 }` and `immutable depositMode`
   - Add `IERC20 public immutable asset` (address(0) iff Native)
   - Bump `VERSION = "4.0.0"`
   - Update `RoundData` struct per ADR-0024 §9 (new fields: `winningTickets[]`, `winners[]`, `winnerPrizeShares[]`, `prizeClaimedAt` mapping, `forfeitBps`, `sponsoredPrize`, `roundFeeSnapshot[]`, `ticketPriceAtRoundOpen`; rename `totalPrincipalMON` → `totalPrincipalAsset`, `totalPrincipalShmonShares` → `totalPrincipalShares`)
   - Remove the V3 `winner`, `winningTicket`, `prizeShares`, `prizeClaimed`, `roundFeeBps`, `roundFeeRecipient` single-value fields (now superseded by array forms)

2. **Add the Merkl surface** (ADR-0024 §3):
   ```solidity
   string public constant name = "EverDraw Position";
   string public immutable symbol;  // set in constructor
   uint8 public immutable decimals; // set in constructor

   function balanceOf(address user) public view returns (uint256 total) {
       // Sum principal across all rounds where user has unwithdrawn position
       // Iterate user's round participations via a separate index
   }

   uint256 private _totalSupply;
   function totalSupply() external view returns (uint256) { return _totalSupply; }

   event Deposit(address indexed recipient, uint256 amount);
   event Withdraw(address indexed recipient, uint256 amount);
   ```

   To compute `balanceOf` efficiently, maintain a running sum:
   ```solidity
   mapping(address => uint256) private _activePrincipal; // user → sum of principalAsset across active rounds
   ```
   Increment in `_buyTickets`, decrement in `withdrawPrincipal`. `balanceOf` returns this mapping directly.

   Emit `Deposit` event in `_buyTickets` (alongside `TicketsBought`) and `Withdraw` in `withdrawPrincipal` (alongside `PrincipalWithdrawn`). Amount in both events is in **asset units**, not yield-vault shares.

3. **Implement generic asset pathway** (ADR-0024 §4):
   ```solidity
   function buyTickets(uint32 ticketCount) external payable {
       _buyTickets(ticketCount);
   }

   function _buyTickets(uint32 ticketCount) internal whenNotPaused nonReentrant {
       if (stoppedAt > 0) revert VaultStopped();
       uint256 rid = currentRoundId;
       RoundData storage r = rounds[rid];
       if (r.state != RoundState.Open) revert BadState();
       if (block.timestamp >= r.salesEndTime) revert SalesEnded();
       if (ticketCount == 0) revert ZeroTickets();

       uint256 cost = uint256(ticketCount) * r.ticketPriceAtRoundOpen;
       uint256 shares;

       if (depositMode == DepositMode.Native) {
           if (msg.value != cost) revert WrongValue();
           shares = yieldVault.deposit{value: cost}(cost, address(this));
       } else {
           if (msg.value != 0) revert UnexpectedValue();
           SafeERC20.safeTransferFrom(asset, msg.sender, address(this), cost);
           SafeERC20.forceApprove(asset, address(yieldVault), cost);
           shares = yieldVault.deposit(cost, address(this));
       }

       if (shares == 0) revert ZeroSharesMinted();

       // ... rest of existing V3 logic: update principalAsset, principalShares, totalUnclaimedShares, tickets, ranges

       // Merkl surface accounting
       _activePrincipal[msg.sender] += cost;
       _totalSupply += cost;
       emit Deposit(msg.sender, cost);
       emit TicketsBought(rid, msg.sender, ticketCount, cost);
   }
   ```

### Day 2 — Multi-winner + sponsor + fee router

4. **Implement multi-winner per ADR-0025**:
   - Constructor takes `numWinners` and `winnerAllocationBps[]`; validate length + sum
   - `_selectWinners` function exactly as in ADR-0025
   - `_finalizeDraw` calls `_selectWinners`, stores results in `r.winningTickets`, `r.winners`, `r.winnerPrizeShares`
   - Handle `effectiveN < numWinners` case → set `forfeitBps`
   - `claimPrize` iterates winners array to aggregate caller's positions
   - Emit `WinnersDrawn(rid, winners[], winningTickets[], prizeShares[])`

5. **Implement sponsor drop-in per ADR-0026**:
   ```solidity
   // Native mode
   function sponsor(uint256 rid, string calldata memo) external payable nonReentrant {
       _sponsor(rid, msg.value, memo);
   }

   // ERC-20 mode
   function sponsorERC20(uint256 rid, uint256 amount, string calldata memo) external nonReentrant {
       require(depositMode == DepositMode.ERC20, "wrong mode");
       SafeERC20.safeTransferFrom(asset, msg.sender, address(this), amount);
       _sponsor(rid, amount, memo);
   }

   function _sponsor(uint256 rid, uint256 amount, string memory memo) internal {
       RoundData storage r = rounds[rid];
       if (r.state != RoundState.Open) revert BadState();
       if (block.timestamp >= r.salesEndTime) revert SalesEnded();
       if (amount == 0) revert ZeroAmount();

       uint256 shares;
       if (depositMode == DepositMode.Native) {
           shares = yieldVault.deposit{value: amount}(amount, address(this));
       } else {
           SafeERC20.forceApprove(asset, address(yieldVault), amount);
           shares = yieldVault.deposit(amount, address(this));
       }
       r.sponsoredPrize += shares;
       sponsorContribution[rid][msg.sender] += shares;
       totalUnclaimedShares += shares;
       emit Sponsored(rid, msg.sender, amount, memo);
   }

   function claimSponsorRefund(uint256 rid) external nonReentrant {
       RoundData storage r = rounds[rid];
       if (r.state != RoundState.Settled) revert BadState();
       if (r.totalTickets > 0) revert NothingToRefund(); // only skip-path rounds refund
       uint256 shares = sponsorContribution[rid][msg.sender];
       if (shares == 0) revert NothingToRefund();
       sponsorContribution[rid][msg.sender] = 0;
       _transferOrDefer(msg.sender, shares, rid, 0xfe);
       emit SponsorRefunded(rid, msg.sender, shares);
   }
   ```

6. **Implement multi-recipient fee router per ADR-0027**:
   - `feeAllocations[]` storage
   - `setFeeAllocations` setter with sum-cap validation
   - `_startNextRound` snapshots `feeAllocations` into `r.roundFeeSnapshot`
   - `_finalizeDraw` loops `roundFeeSnapshot` and transfers each share via `_transferOrDefer`
   - Emit `ProtocolFeeAccrued` per recipient (unchanged event shape from V3)

### Day 3 — Transfer resilience + randomness oracle + stop()

7. **Implement `_transferOrDefer` per ADR-0028**:
   - Try/catch around `yieldVault.transfer`
   - Pending state mapping
   - `claimDeferred(rid, slot)` and `claimAllDeferred(rid, slots[])` retry paths
   - Events `TransferDeferred`, `DeferredClaimSucceeded`
   - Replace EVERY `yieldVault.transfer(...)` call in the contract with `_transferOrDefer(...)` — there should be NO direct transfers left
   - Slot numbering: 0x00..0x1f reserved for winner positions (0..31), 0xfe = sponsor refund, 0xff = principal withdraw, 0xf0..0xf7 = fee recipients 0..7

8. **Implement randomness oracle abstraction per ADR-0029**:
   - Define `IRandomnessOracle` interface
   - V4 vault stores `IRandomnessOracle public randomnessOracle`, queues changes with 24h timelock
   - `_commitDraw` calls `randomnessOracle.requestRandomness(...)` instead of `entropy.requestWithCallback(...)`
   - `onRandomnessReceived(uint64,bytes32)` is the new callback (replaces `entropyCallback`)
   - Create `src/PythRandomnessOracle.sol` as the bridge adapter

9. **Implement `stop()` per ADR-0024 §5**:
   - `uint64 public stoppedAt` (0 = not stopped)
   - `function stop() external onlyOwner` sets timestamp, irreversible
   - `_buyTickets` and `_startNextRound` both check `stoppedAt`
   - `_startNextRound`: if `stoppedAt > 0` do NOT open a new round; the current round runs to completion and that's the end
   - Emit `VaultStopped(uint64 stoppedAt)`

10. **Implement pause role separation per ADR-0024 §8**:
    - `address public pauser` (defaults to owner)
    - `setPauser(address) external onlyOwner`
    - `pause()` / `unpause()` gated on `onlyPauser` (NOT `onlyOwner`)
    - Owner remains owner of all other admin functions

### Day 4 — Tests

11. **Foundry tests covering every spec item.** Minimum coverage:

    Required test suites (each ≥10 cases):
    - `V4_MerklSurface_Test` — balanceOf/totalSupply correctness across deposit/withdraw/skip/multi-round, Deposit/Withdraw events emitted correctly
    - `V4_GenericAsset_Native_Test` — full lifecycle for native mode
    - `V4_GenericAsset_ERC20_Test` — full lifecycle for ERC-20 mode; reject fee-on-transfer tokens; approval edge cases
    - `V4_MultiWinner_Test` — selection uniqueness; effectiveN < numWinners path; allocation math; rounding to position 0; same-buyer multi-position
    - `V4_Sponsor_Test` — sponsor adds to pool; sponsor on skipped round refunds; sponsor cannot sponsor after sales-end; yield earned on sponsored shares reaches prize
    - `V4_FeeRouter_Test` — multi-recipient split; sum-cap enforcement; snapshot at round open; live config changes don't affect in-flight rounds
    - `V4_TransferResilience_Test` — using a `PausableMockYieldVault`, pause the vault mid-settle and verify the round still reaches Settled state with pending claims; verify retry works after unpause; verify `totalUnclaimedShares` invariant holds
    - `V4_OracleAbstraction_Test` — using a `MockRandomnessOracle`, verify the request → callback flow works identically to V3 Pyth direct
    - `V4_Stop_Test` — stop blocks buyTickets; doesn't block claims/withdraws/settlement; one-way irreversible
    - `V4_PauseRoleSeparation_Test` — pauser can pause, non-pauser cannot; owner can change pauser; pauser cannot change pauser
    - `V4_V3HardeningRegression_Test` — every guarantee from V3 still holds (fee snapshot, entropy timelock, two-step ownership, etc.)

    Target: all suites pass, **forge test** clean.

12. **Mock contracts** needed for tests:
    - `MockERC20` (standard + fee-on-transfer variant)
    - `MockERC4626YieldVault` (with `pause()` toggle for resilience testing)
    - `MockRandomnessOracle` (deterministic, takes pre-set random values)

### Day 5 — Audit + ABI + deployment scripts

13. **Internal audit pass**: builder does a self-audit against the V4 audit scope in ADR-0024 §14. Document findings in a `tasks/v4-internal-audit-2026-06-XX.md` file. Operator reviews and approves before deploy.

14. **Regenerate ABI**: `abi/TicketPrizePoolV4.json` and `abi/PythRandomnessOracle.json`. Validate with `npm run check:abi`.

15. **Add `deploy:mainnet:v4` script**: `scripts/deploy-ticket-prize-pool-v4.js`, mirroring V3 deploy but with V4's constructor signature. Use the `V4Config` struct from ADR-0024 §10.

16. **Update `deployments/monad-mainnet.json`** template entries for V4 vaults (will be populated post-deploy).

17. **Update `scripts/check-production-source-manifest.mjs`** if necessary to handle V4 entries.

---

## File-by-file deliverables

```
src/TicketPrizePoolV4.sol                    NEW — main contract, ~1500-1800 lines
src/PythRandomnessOracle.sol                 NEW — adapter, ~80 lines
src/interfaces/IYieldVault.sol               NEW — ERC-4626 + balanceOf
src/interfaces/IRandomnessOracle.sol         NEW — abstraction
src/interfaces/IRandomnessOracleConsumer.sol NEW — callback target

abi/TicketPrizePoolV4.json                   NEW (autogen)
abi/PythRandomnessOracle.json                NEW (autogen)

test/V4_MerklSurface.t.sol                   NEW
test/V4_GenericAsset_Native.t.sol            NEW
test/V4_GenericAsset_ERC20.t.sol             NEW
test/V4_MultiWinner.t.sol                    NEW
test/V4_Sponsor.t.sol                        NEW
test/V4_FeeRouter.t.sol                      NEW
test/V4_TransferResilience.t.sol             NEW
test/V4_OracleAbstraction.t.sol              NEW
test/V4_Stop.t.sol                           NEW
test/V4_PauseRoleSeparation.t.sol            NEW
test/V4_V3HardeningRegression.t.sol          NEW
test/mocks/MockERC20.sol                     NEW
test/mocks/MockERC4626YieldVault.sol         NEW
test/mocks/MockRandomnessOracle.sol          NEW

scripts/deploy-ticket-prize-pool-v4.js       NEW
package.json                                 EDIT — add deploy:mainnet:v4 script

deployments/monad-mainnet.json               EDIT — add V4 vault entries (post-deploy)
tasks/v4-internal-audit-2026-06-XX.md        NEW — self-audit findings

CLAUDE.md / decisions/README.md              EDIT — index the new ADRs (already done)
```

---

## Out of scope (do not implement)

- Sponsor stake-shMON-yield model (V4.1)
- VaultFactory contract (V4.1)
- Pause-controller hub contract (V4.1)
- Cross-vault MegaDraw orchestrator (V4.1)
- TWAB / continuous deposits (deferred per ADR-0007)
- Frontend changes (separate ticket after V4 deploys)
- Indexer schema migration (separate ticket after V4 deploys)
- External audit firm engagement

---

## Don't

- **Don't modify V3 contracts.** They're deployed and immutable on mainnet. Touching `src/TicketPrizePoolShmonV3.sol` corrupts the manifest.
- **Don't shortcut the `_transferOrDefer` wrapper.** Every yield-vault transfer in the contract goes through it. If you leave a direct `transfer` call somewhere, the audit will catch it and you'll redo it. Use `git grep yieldVault.transfer` before declaring done — should return only the inside of `_transferOrDefer`.
- **Don't change the cadence invariant.** `roundDurationSec` and `yieldPeriodSec` for production-deploy V4 vaults must match ADR-0010 (24h round, 518100s yield). The contract accepts other values but the operator will reject any deploy that uses non-ADR-0010 values for the mainnet Vault A / Vault B slots.
- **Don't make `numWinners` mutable.** ADR-0025 explicitly locks it as immutable per-vault. Adding a setter is a design regression.
- **Don't optimize away the per-position `prizeClaimedAt` mapping.** A packed bitfield is tempting but the audit clarity is worth the storage cost.
- **Don't add new owner-only functions beyond what's specified.** Every admin power is documented in ADR-0022. New ones need an ADR.

---

## Acceptance criteria

The operator merges this PR when **all** of these are true:

1. `forge test` passes cleanly with zero failing or skipped tests
2. `forge build` clean, no warnings other than the existing optimizer notice
3. `npm run check:abi` passes
4. `npm run check:deploy-source` passes after V4 manifest entries added
5. Internal audit document exists in `tasks/` with findings + resolutions
6. The contract has **zero** direct `yieldVault.transfer(...)` calls outside `_transferOrDefer`
7. The Merkl surface checks pass: `balanceOf` of a user with no deposits returns 0; a user who deposits 5 MON gets `balanceOf` of 5e18 immediately; `Deposit` event fires; the same user withdrawing after settlement gets `balanceOf` back to 0 and a `Withdraw` event fires
8. All ADRs referenced in this ticket have implementations that match their spec — builder must cite each ADR in PR description as evidence

---

## Deploy plan (operator-side, AFTER PR is merged)

Detailed in `tasks/v4-deploy-runbook.md`. Summary:

1. Deploy `PythRandomnessOracle` for each V4 vault (1 oracle per vault)
2. Deploy V4 Vault A with native MON + shMON, Wed 13:00 UTC anchor
3. Deploy V4 Vault B with native MON + shMON, Sun 01:00 UTC anchor
4. Seed each VRF reserve with 20 MON
5. Re-register V4 addresses with Merkl (delete previous V3 form submission, submit V4 addresses)
6. Update Vercel `VITE_POOL_ADDRESSES_V4` env
7. Update Fly keeper + indexer secrets
8. Update deployment manifest
9. Run live verification per the end-to-end rule

---

## When you run into something unclear

The spec is dense. If something is genuinely underspecified:

1. **First**, re-read the parent ADR (linked at the top of each section)
2. **Second**, look at how V3 handled the analogous case — V4 carries V3 patterns forward unless explicitly overridden
3. **Third**, if still unclear, push a partial PR and tag it with the question. Do NOT silently make a design call. The operator has been burned by silent design decisions (the V3 missing-Merkl-surface incident is the exact thing this rule prevents).

Tag questions in the PR description, not as separate messages. The operator reviews the PR and answers there.

---

## Time accounting

Day 1: skeleton + Merkl + generic asset = 8 hours focused work
Day 2: multi-winner + sponsor + fee router = 8 hours
Day 3: transfer resilience + oracle abstraction + stop + pause separation = 8 hours
Day 4: tests = 8 hours (this WILL feel under-resourced; if it spills to day 5, that's fine)
Day 5: internal audit + ABI + deploy script = 4-6 hours

Total: ~36-40 hours of focused builder time, compressed into 5 calendar days.

This is aggressive. The operator has accepted the timeline + skipped external audit. The trade is: V4 ships fast, V4.1 (with stake-yield sponsor + factory + pause hub) plus an external audit happens in the next month.
