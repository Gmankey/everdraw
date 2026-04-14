# Phase 2b Builder Spec — V2 Test Suite

**Parent:** `phase2-shmon-native-plan.md`
**Tests:** `phase2-builder-spec-a-v2-contract.md` (the contract being tested)
**Effort:** 3-4 days
**Framework:** Foundry (unit + fork) + optional Playwright (E2E)

---

## Objective

Comprehensive test coverage for `TicketPrizePoolShmonV2` before mainnet deploy. Unit tests use a controllable mock shMON; fork tests hit real shMON on a pinned Monad mainnet block.

Target: **>90% line coverage, >85% branch coverage** on the V2 contract.

---

## File layout

**New:**
- `test/V2/MockShmon.sol` — controllable ERC-4626 mock
- `test/V2/TicketPrizePoolShmonV2.t.sol` — unit tests (all groups below)
- `test/V2/TicketPrizePoolShmonV2.fork.t.sol` — fork tests against real shMON
- `test/V2/Invariants.t.sol` — Foundry invariant/fuzz tests
- `test/V2/helpers/TestHelpers.sol` — shared setup, fixture helpers
- `web/tests/e2e/vault-c.spec.ts` — optional Playwright E2E

---

## Mock shMON design (`MockShmon.sol`)

```solidity
contract MockShmon {
    // ERC-20 share accounting
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    // Rate control: shares-to-assets ratio, scaled by 1e18
    // Default 1e18 = 1:1. Tests can call setRate() to simulate yield.
    uint256 public ratePerShare = 1e18;

    // Failure injection for negative tests
    bool public transferFailsNext;
    bool public depositReturnsZero;

    // Track native MON held for deposit()
    receive() external payable {}

    // Test-only knobs
    function setRate(uint256 newRate) external { ratePerShare = newRate; }
    function setTransferFailsNext(bool v) external { transferFailsNext = v; }
    function setDepositReturnsZero(bool v) external { depositReturnsZero = v; }
    function mintTo(address to, uint256 shares) external { /* for fixture setup */ }

    // ERC-4626-ish surface
    function deposit(uint256 assets, address receiver) external payable returns (uint256) {
        if (depositReturnsZero) return 0;
        require(msg.value == assets, "mock: value mismatch");
        uint256 shares = (assets * 1e18) / ratePerShare;
        balanceOf[receiver] += shares;
        totalSupply += shares;
        return shares;
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return (assets * 1e18) / ratePerShare;
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return (assets * 1e18) / ratePerShare;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * ratePerShare) / 1e18;
    }

    // ERC-20
    function transfer(address to, uint256 amount) external returns (bool) {
        if (transferFailsNext) { transferFailsNext = false; return false; }
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (transferFailsNext) { transferFailsNext = false; return false; }
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
```

**Why a mock:** fast tests + full rate control. Fork tests still cover real shMON behavior.

---

## Unit test scenarios (67 total)

### Group 1 — `buyTicketsMON` basics (10)
1. Buy 1 ticket with exact msg.value → `TicketsPurchased` event, position recorded, shares minted
2. Buy 3 tickets → cost = 3x, single aggregated position
3. Wrong msg.value (low) → `WrongValue`
4. Wrong msg.value (high) → `WrongValue`
5. ticketCount = 0 → `ZeroTickets`
6. After `salesEndTime` → `SalesEnded`
7. While paused → `EnforcedPause`
8. State != Open → `BadState`
9. Mock returns 0 shares → `ZeroSharesMinted`
10. Same user buys twice → single position, shares + principal accumulated, ranges merged

### Group 2 — `buyTicketsShmon` basics (8)
11. User approves exact amount, buys 1 ticket → correct shares pulled (`previewWithdraw(cost) + 1`), position recorded
12. Without approve → `TransferFailed`
13. Insufficient shMON balance → `TransferFailed`
14. MAX_UINT approval → works for many buys
15. Mixed: user does `buyTicketsMON` then `buyTicketsShmon` in same round → single aggregated position
16. Rate changes between approve and buy → correct shares computed at buy time
17. After `salesEndTime` → `SalesEnded`
18. Mock `previewWithdraw` returns 0 → `ZeroShares`

### Group 3 — `commit` & lifecycle (6)
19. Commit after salesEndTime with tickets → `Committed`, `targetBlockNumber` set
20. Commit with 0 tickets → `Skipped`, next round started
21. Commit before salesEndTime → `SalesNotEnded`
22. Commit when state != Open → `BadState`
23. Mock shmon verifies `requestUnstake` is NEVER called during commit (expect no-call)
24. Multiple buys across round → all included in `totalTickets`

### Group 4 — `settle` yield math (10)
25. Target block mined: correct winner picked from `blockhash`
26. Positive yield (rate up mid-round): `prizeShares == totalShmonShares - previewDeposit(totalPrincipalMON)`
27. Zero yield (rate unchanged): `prizeShares == 0`
28. Negative yield (rate down): `prizeShares == 0`, no revert
29. Settle before target block → `TooEarly`
30. Settle after `targetBlockNumber + 255` → state becomes `Failed`, no revert, next round starts
31. State != Committed → `BadState`
32. Deterministic winner on reruns with same blockhash
33. Single-ticket round → that ticket always wins
34. Two-ticket round → `blockhash % 2` picks correctly

### Group 5 — `withdrawPrincipal` (8)
35. Winner withdraws → same shares as deposited
36. Loser withdraws → same shares as deposited
37. Multi-round withdraws tracked independently
38. Double withdraw same round → `NothingToWithdraw`
39. State not Settled/Skipped/Failed → `BadState`
40. Withdraw in Skipped state works
41. Withdraw in Failed state works (principal recovery)
42. Rate change after settle doesn't affect shares returned

### Group 6 — `claimPrize` (7)
43. Winner claims → `prizeShares` transferred, `PrizeClaimed` event
44. Non-winner claims → `NotWinner`
45. Winner claims twice → `AlreadyClaimed`
46. State != Settled → `BadState`
47. `prizeShares == 0` → `NoPrize`
48. Winner can `claimPrize` + `withdrawPrincipal` in any order
49. Total shares out (principal + prize) ≤ pool's share balance

### Group 7 — Accounting invariants (6)
50. `sum(positions.principalShmonShares) == r.totalShmonShares` before settle
51. After all withdraws + claims, `mockShmon.balanceOf(pool) == 0` (modulo dust)
52. `principalSharesAtSettle + prizeShares == totalShmonShares` when yield ≥ 0
53. `principalSharesAtSettle == totalShmonShares` AND `prizeShares == 0` when yield ≤ 0
54. Event-emitted `totalPrincipalMON` matches storage
55. Fuzz: random amounts × random rate changes → invariants hold

### Group 8 — Security (6)
56. Reentrant call via mock shmon deposit hook → reverts with `Reentrant`
57. Reentrant call via mock shmon transfer hook → reverts
58. Donation attack: externally transfer shMON to pool → `totalShmonShares` unchanged, prize calc unaffected
59. Ticket range overflow at `type(uint32).max` → reverts
60. Owner pause blocks new buys but allows withdraws/claims
61. Two-step ownership transfer works; old owner can't call after accept

### Group 9 — Edge cases (6)
62. Round with 1 wei of yield (precision)
63. Round with 1e27 wei of yield (large)
64. Exact ticketPriceMON then immediate withdraw in Skipped round
65. `previewWithdraw` off-by-one: verify the `+1` buffer in contract actually prevents under-funding
66. Rate exactly 1e18 (no yield, no loss)
67. Multi-user mixed deposits (some MON, some shMON), withdrawals in arbitrary order

---

## Invariant / fuzz tests (Foundry)

`test/V2/Invariants.t.sol` — Foundry invariant testing framework:

- **Invariant 1:** For any round, `sum of user positions == totalShmonShares`
- **Invariant 2:** After settlement, `principalSharesAtSettle + prizeShares <= totalShmonShares`
- **Invariant 3:** Pool's share balance ≥ unwithdrawn-principal + unclaimed-prize at all times
- **Invariant 4:** `currentRoundId` is monotonically non-decreasing
- **Invariant 5:** No user can withdraw more shares than they deposited

Configure with 256+ runs, 15+ depth.

---

## Fork tests (pinned Monad mainnet block)

### Setup
```solidity
// foundry.toml: [profile.fork] ...
// Pin a block from the day of test writing:
uint256 constant FORK_BLOCK = <fill_in_before_running>;
string constant MONAD_RPC = "https://rpc.monad.xyz";

function setUp() public {
    vm.createSelectFork(MONAD_RPC, FORK_BLOCK);
    shmon = IShMonad(0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c);
    pool = new TicketPrizePoolShmonV2(address(shmon), 1 ether, 60 * 60, owner);
    vm.deal(alice, 100 ether);
    vm.deal(bob, 100 ether);
}
```

### Fork scenarios (5)

**FT-1: End-to-end happy path with real shMON**
- Alice buys 1 ticket with MON via `buyTicketsMON`
- Bob approves shMON, buys 1 ticket via `buyTicketsShmon`
- `vm.warp` past `salesEndTime`
- Call `commit` → `Committed`
- `vm.roll` past `targetBlockNumber`
- Call `settle` → winner picked, `prizeShares` computed
- Winner + loser both withdraw → verify shMON balances

**FT-2: Real rate behavior**
- Deposit at fork block rate
- `vm.rollFork(FORK_BLOCK + N)` to a later block (simulates rate drift)
- Settle → verify `prizeShares = totalShmonShares - previewDeposit(totalPrincipalMON)` at settle-time rate

**FT-3: `previewWithdraw` rounding behavior**
- Call `previewWithdraw(1 ether)` at fork block, record result
- Deposit via `buyTicketsShmon` with `+1` buffer
- Verify no under-pull (pool received ≥ shares needed for principal)
- **Decision output:** if `previewWithdraw` already rounds up, remove the `+1` in contract before deploy

**FT-4: Real shMON transfer paths**
- Pool calls `shmon.transfer(alice, shares)` → verify alice's balance increases
- Alice calls `shmon.approve(pool, shares)` → pool calls `transferFrom` → verify success

**FT-5: Keeper script dry-run against fork**
- Deploy V2 on fork
- Run `scripts/keeper-execute-next.js` pointing at fork RPC
- Verify keeper advances state correctly: Commit → Settle (no requestUnstake attempts)

---

## Frontend E2E (Playwright, optional)

`web/tests/e2e/vault-c.spec.ts` — runs against local dev + testnet V2 deployment:

- FE-1: Connect wallet, see Vault C card
- FE-2: Buy 1 ticket with MON → confirm in wallet → success toast → position visible
- FE-3: Approve shMON → buy 1 ticket with shMON → success
- FE-4: Wait for round settlement (use testnet with short round duration) → "Withdraw Principal" button appears
- FE-5: Click withdraw → shMON appears in wallet balance
- FE-6: Navigate to shMON tab → instant-unstake small amount → MON arrives
- FE-7: Back to shMON tab → schedule-unstake → pending card shows → wait epoch → complete → MON arrives

---

## CI integration

- **Unit tests** run on every commit via `forge test --match-path "test/V2/TicketPrizePoolShmonV2.t.sol"`
- **Invariants** run on PR merge: `forge test --match-path "test/V2/Invariants.t.sol"`
- **Fork tests** run on PR merge (rate-limited RPC aware): `forge test --match-path "test/V2/*.fork.t.sol" --fork-url $MONAD_RPC`
- **Gas snapshot** tracked: `forge snapshot` committed, regressions flagged in PR
- **Coverage** reported: `forge coverage --match-path "test/V2/*"`

---

## Pre-deployment checklist

- [ ] All 67 unit tests green
- [ ] All 5 fork tests green at pinned block
- [ ] Invariant tests pass with 256+ runs
- [ ] Coverage: lines >90%, branches >85% on V2 contract
- [ ] Gas snapshot: no regression vs V1 for `buyTicketsMON`, settle cheaper than V1
- [ ] `slither src/TicketPrizePoolShmonV2.sol` — no new high severity findings
- [ ] Internal review by second pair of eyes
- [ ] Testnet deploy + keeper runs 3+ full rounds without intervention
- [ ] Monitoring/alerts configured (TG bot on `RoundFailed`, keeper errors)
- [ ] Deploy script parameterized and reviewed
- [ ] Frontend Vault C feature flag gates visibility until contract verified on explorer
- [ ] Mainnet deploy script dry-run on a fork
- [ ] Post-deploy smoke test plan ready (buy ticket, wait, settle, withdraw, claim)

---

## Exit criteria

The test suite is complete when:
- [ ] Every function in `TicketPrizePoolShmonV2` has at least one positive and one negative test
- [ ] All custom errors are triggered by at least one test
- [ ] Every event signature is asserted at least once
- [ ] All state transitions are covered
- [ ] The previewWithdraw rounding decision (`+1` or not) is definitively resolved via FT-3
- [ ] CI green on all test profiles
