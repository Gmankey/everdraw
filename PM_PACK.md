# Monad Prize Pool — PM Pack & Mainnet Readiness Assessment

**Date:** 2026-02-28
**PM:** Claude (Opus)
**Builder:** ChatGPT
**Deploy target:** `TicketPrizePoolShmonShMonad.sol`
**Chain:** Monad mainnet

---

## 1) How It Works (for reviewers reading cold)

Users send MON (Monad native token) to buy tickets. The contract immediately deposits all MON into ShMonad (shMON), which stakes it and accrues yield. After the round timer ends:

1. **Commit** — a future block number is recorded for randomness
2. **Draw** — `blockhash(targetBlock)` picks a random winning ticket. The shMON unstake is requested.
3. **Settle** — once ShMonad allows `completeUnstake()`, the contract receives MON back. Yield = MON received - principal deposited.
4. **Claim** — the winner gets the entire yield pot. All depositors get their principal back (pro-rata reduced if slashing occurred).

It's a no-loss lottery: you either win the yield or get your money back.

---

## 2) Contract Architecture

### Deploy candidate: `TicketPrizePoolShmonShMonad.sol` (~660 lines)

- **No owner/admin** (currently). Emergency pause is a required addition (see Section 5).
- **Non-upgradeable.** Once deployed, immutable.
- **Fully permissionless.** Anyone can call `executeNext()` to advance rounds.
- **Single active finalization.** Only one round can be in the unstake-pending state at a time (`activeFinalizingRoundId`). This is because ShMonad's `completeUnstake()` is per-account, not per-request.

### Key immutables (set at deploy, never changeable)

| Parameter | Testnet value | **Mainnet value** | Notes |
|-----------|-------------|-------------------|-------|
| `ticketPriceMON` | 0.01 MON | **0.1 MON** | Price per ticket |
| `commitDelayBlocks` | 5 | **10** | Blocks between commit and draw |
| `roundDurationSec` | 10 minutes | **7 days (604800)** | Sales window per round |
| `shmon` | (testnet addr) | **(TBD — owner to provide)** | ShMonad proxy address |
| Protocol fee | 0% | **0%** | No fee for v1 |

### State machine

```
Open → [sales end] → Committed → [target block + 1..255] → Finalizing → [completeUnstake succeeds] → Settled
                      ↓ (if empty)
                      Settled (via skipRound)
```

---

## 3) Security Audit — Issues Found

### CRITICAL

#### C1. No emergency pause / no admin controls
**Severity:** Critical for mainnet
**Current state:** Zero admin functionality. If an exploit is found post-deploy, there is no way to pause ticket sales, block withdrawals, or rescue funds.
**Decision:** Owner confirmed they want emergency pause. Must be added before deploy.
**Action:** Add `Ownable` + `Pausable` pattern. Pause should halt `buyTickets()` and optionally `executeNext()`. Claims/withdrawals should remain available even when paused (users must always be able to get their money out).

#### C2. Blockhash randomness is manipulable
**Severity:** Critical in theory, accepted risk for v1
**Current state:** Winner selection uses `keccak256(blockhash(targetBlockNumber), roundId)`. On Monad (single sequencer), the sequencer can theoretically influence which block hash appears.
**Decision:** Owner accepted blockhash for v1 with small pots. Document the risk. Plan VRF upgrade path for v2.
**Mitigation for v1:** Keep `commitDelayBlocks` high enough (5+) so manipulation requires sustained block withholding. Monitor for suspicious patterns.

### HIGH

#### H1. Reentrancy on `claimPrize()` and `withdrawPrincipal()`
**Severity:** High (mitigated by checks-effects-interactions pattern)
**Current state:** Both functions use raw `.call{value:}()` to send MON. However, `claimPrize()` sets `prizeClaimed = true` and zeros `yieldMON` BEFORE the call. `withdrawPrincipal()` zeros `principalMON[rid][msg.sender]` BEFORE the call. So reentrancy is blocked by the state checks.
**Assessment:** Correctly mitigated by CEI pattern. BUT — adding an explicit `nonReentrant` modifier (OpenZeppelin `ReentrancyGuard`) would be defense-in-depth. Cost: ~2400 gas per call. Worth it for mainnet.
**Action:** Add `ReentrancyGuard` to `claimPrize`, `withdrawPrincipal`, and `buyTickets`.

#### H2. `completeUnstake()` can receive unexpected MON amount
**Severity:** High
**Current state:** `_settleRound()` measures `balAfter - balBefore` around `completeUnstake()`. But if someone sends MON directly to the contract (via `receive()`) between `balBefore` and `balAfter` in the same transaction, the yield calculation would be inflated.
**Assessment:** In practice, this requires a same-transaction injection which is hard to trigger externally. But a malicious ShMonad implementation or a callback during `completeUnstake()` could inflate yield. Since ShMonad is a trusted external contract, risk is medium.
**Mitigation:** Consider storing expected principal and comparing against known ShMonad share value rather than raw balance diff. Alternatively, accept the risk since ShMonad is trusted infrastructure.

#### H3. No ticket count overflow protection (uint32)
**Severity:** Medium-high
**Current state:** `totalTickets` is `uint32` (max ~4.29 billion). At 0.01 MON per ticket, overflow requires ~42.9 million MON deposited in one round. Unlikely but not impossible at scale.
**Action:** Add explicit overflow check: `require(uint256(start) + uint256(ticketCount) <= type(uint32).max, "ticket overflow")`.

### MEDIUM

#### M1. 256-block window for blockhash is tight
**Severity:** Medium
**Current state:** After commit, the draw must happen within 256 blocks of `targetBlockNumber`. If the automation bot fails or nobody calls `drawWinner()` in time, the blockhash expires and the round is stuck in `Committed` state forever. Funds are locked.
**Action:** Add a recovery path: if blockhash expires, allow re-committing with a new target block, or allow settling as a "no winner" round (return all principal, no prize).

#### M2. Round stuck in `Finalizing` blocks all future rounds
**Severity:** Medium
**Current state:** `activeFinalizingRoundId` must be 0 for any new round to draw. If `completeUnstake()` permanently reverts (ShMonad bug), ALL future rounds are permanently blocked. No funds from the stuck round can be recovered.
**Action:** Add a timeout on finalization. If N blocks/seconds pass without settlement, allow force-settling with `lossRatio = 1e18` and `yieldMON = 0` (treat as if principal was returned with no yield). This requires an admin override.

#### M3. No protocol fee
**Severity:** Business risk, not security
**Current state:** 100% of yield goes to the winner. The protocol operator gets nothing.
**Action:** If you want to monetize, add an optional protocol fee (e.g., 5% of yield) sent to a treasury address. This can be immutable or admin-configurable. Decide before deploy.

#### M4. ShMonad deposit could return fewer shares than expected
**Severity:** Medium
**Current state:** `shmon.deposit{value: cost}(cost, address(this))` returns shares. The contract checks `shares == 0` but doesn't check if shares < cost. If ShMonad has a different exchange rate (not 1:1), the accounting could diverge.
**Assessment:** If ShMonad uses a variable exchange rate, `totalShmonShares` tracks actual shares, and settlement uses `completeUnstake()` which converts shares back to MON. The accounting is share-based, not MON-based, for the staking portion. This should be fine as long as ShMonad's deposit/unstake are consistent.
**Action:** Verify ShMonad exchange rate behavior. If variable rate, the current code is correct. If always 1:1, the `shares == 0` check is sufficient.

### LOW

#### L1. `legacyRevert` / `LEGACY_ERR_SELECTOR` is tech debt
**Severity:** Low (no security impact)
**Current state:** The contract has a custom revert encoding mechanism (`_legacyRevert`) to maintain backwards compatibility with tests that were written for the older contract. This adds ~100 lines of complexity.
**Action:** For mainnet cleanliness, consider removing legacy wrapper functions and using standard custom errors throughout. Update tests to match.

#### L2. No event indexing for off-chain tracking
**Severity:** Low
**Current state:** Events are emitted but some lack indexed parameters that would help off-chain indexers. `PrincipalWithdrawn` has `indexed roundId` and `indexed user` which is good. But there's no aggregate event for round lifecycle completion.
**Action:** Fine for v1. Consider adding a subgraph or indexer post-launch.

---

## 4) Test Coverage Gap — BLOCKER

**This is the single biggest blocker for mainnet.**

The deploy target is `TicketPrizePoolShmonShMonad.sol`, but **12 of 14 test files test the older `TicketPrizePoolShmon.sol`**. The interfaces are different:

| Feature | TicketPrizePoolShmon (tested) | TicketPrizePoolShmonShMonad (deploy target) |
|---------|------------------------------|-------------------------------------------|
| Staking interface | `IShmonadStaker` (stake/requestUnstake/claimUnstake) | `IShMonad` (deposit/requestUnstake/completeUnstake) |
| Finalization lock | None (parallel unstakes) | `activeFinalizingRoundId` (serial) |
| Automation | Manual per-step calls only | `executeNext()` automation-first |
| Skip empty rounds | Not supported | `skipRound()` / `NextAction.Skip` |
| Cursor scanning | Not present | `cursorRoundId` + `nextExecutable()` |

**Only 7 tests cover the deploy target.** The following are NOT tested on `TicketPrizePoolShmonShMonad.sol`:

- Reentrancy attacks (tested only on older contract)
- Loss ratio / partial slashing accounting
- Principal withdrawal correctness
- Multi-user claim flows
- Griefing / spam attacks
- Range merging / binary search correctness
- Invariant fuzzing (pool solvency)
- Edge cases: zero yield, total loss, dust amounts
- `executeNext()` full lifecycle (commit → draw → settle via automation)
- Blockhash expiry edge case
- Multiple rounds overlapping

**Action:** Port all test suites to target `TicketPrizePoolShmonShMonad.sol`. This is mandatory before mainnet.

---

## 5) Action Plan — Path to Mainnet

### Phase 1: Contract hardening (MUST DO before deploy)

| # | Task | Priority | Est. effort |
|---|------|----------|-------------|
| 1.1 | Add `Ownable` + `Pausable` (pause `buyTickets`, `executeNext`; keep claims open) | Critical | 2-3 hours |
| 1.2 | Add `ReentrancyGuard` to `claimPrize`, `withdrawPrincipal`, `buyTickets` | High | 1 hour |
| 1.3 | Add uint32 ticket overflow check | High | 15 min |
| 1.4 | Add blockhash-expiry recovery path (re-commit or force-settle) | Medium | 2-3 hours |
| 1.5 | Add finalization timeout (force-settle stuck rounds) | Medium | 2 hours |
| 1.6 | Decide on protocol fee — add if wanted | Business | 1-2 hours |

### Phase 2: Test coverage (MUST DO before deploy)

| # | Task | Priority | Est. effort |
|---|------|----------|-------------|
| 2.1 | Port reentrancy tests (SecurityE) to ShMonad contract | Critical | 2 hours |
| 2.2 | Port accounting tests (AccountingC) to ShMonad contract | Critical | 2 hours |
| 2.3 | Port claims tests (ClaimsB) to ShMonad contract | Critical | 1 hour |
| 2.4 | Port guardrails tests (Guardrails) to ShMonad contract | High | 1 hour |
| 2.5 | Port range/binary-search tests (RangesD) to ShMonad contract | High | 1 hour |
| 2.6 | Port invariant fuzz suite to ShMonad contract | High | 2-3 hours |
| 2.7 | New: `executeNext()` full lifecycle test | High | 2 hours |
| 2.8 | New: blockhash expiry + recovery test | High | 1 hour |
| 2.9 | New: finalization timeout + force-settle test | High | 1 hour |
| 2.10 | New: multi-round overlapping lifecycle test | Medium | 2 hours |

### Phase 3: Deploy prep (after Phase 1+2)

| # | Task | Priority |
|---|------|----------|
| 3.1 | Confirm ShMonad mainnet address + verify interface compatibility | Critical |
| 3.2 | Decide final deploy parameters (ticket price, round duration, commit delay) | Critical |
| 3.3 | Deploy to Monad testnet first, run full lifecycle with real ShMonad | Critical |
| 3.4 | Run automation bot against testnet for 24-48 hours (prove `executeNext` reliability) | High |
| 3.5 | Deploy to mainnet | — |
| 3.6 | Verify contract on block explorer | — |

### Phase 4: Post-deploy (nice to have)

| # | Task |
|---|------|
| 4.1 | Frontend / UI for buying tickets and checking results |
| 4.2 | Automation bot deployment (call `executeNext()` on cron) |
| 4.3 | Subgraph / indexer for round history |
| 4.4 | VRF upgrade path design (v2) |

---

## 6) PM Decisions Needed Now

1. **Protocol fee:** Do you want a cut of the yield? If yes, what %? This changes the contract before deploy.
2. **Deploy parameters:** The deploy script hardcodes 0.01 MON / 5 blocks / 10 minutes. Are these final? 10-minute rounds seems very short for a real lottery — most no-loss lotteries run weekly or daily.
3. **Testnet first?** I strongly recommend a testnet deployment with real ShMonad interaction before mainnet. Is Monad testnet available?
4. **Automation:** Who/what will call `executeNext()`? Need a reliable bot. If the bot goes down and nobody calls within 256 blocks of the target, rounds get stuck.
5. **Remove legacy contracts?** Should we delete `PrizeVault.sol`, `TicketPrizePool.sol`, `TicketPrizePoolShmon.sol` and their tests from the repo to reduce confusion? Or keep for reference?
