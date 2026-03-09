// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../src/TicketPrizePoolShmon.sol";

/*//////////////////////////////////////////////////////////////
                    INVARIANT STAKER (1:1)
//////////////////////////////////////////////////////////////*/

contract InvariantStaker is IShmonadStaker {
    uint256 public nextRequestId = 1;
    mapping(uint256 => uint256) public amt;

    function stake() external payable returns (uint256) {
        return msg.value;
    }

    function requestUnstake(uint256 shmonAmount) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        amt[requestId] = shmonAmount;
    }

    function isUnstakeReady(uint256) external pure returns (bool) { return true; }

    function claimUnstake(uint256 requestId, address to) external returns (uint256 monAmount) {
        monAmount = amt[requestId];
        amt[requestId] = 0;
        (bool ok,) = to.call{value: monAmount}("");
        require(ok, "xfer fail");
    }

    receive() external payable {}
}

/*//////////////////////////////////////////////////////////////
                        POOL HANDLER
    Foundry will fuzz-call these methods in random order.
//////////////////////////////////////////////////////////////*/

contract PoolHandler is Test {
    TicketPrizePoolShmon public pool;
    uint96  public price;

    address[] internal _users;
    uint256 public constant RID = 1;

    constructor(TicketPrizePoolShmon _pool, uint96 _price) {
        pool = _pool;
        price = _price;

        // Fixed actors
        _users.push(address(0xA11cE));
        _users.push(address(0xB0b));
       _users.push(address(0xCA001));
        _users.push(address(0xD00D));
        _users.push(address(0xEeee));

        for (uint256 i = 0; i < _users.length; i++) {
            vm.deal(_users[i], 10_000 ether);
        }
    }

    function usersLength() external view returns (uint256) { return _users.length; }
    function users(uint256 i) external view returns (address) { return _users[i]; }

    function _u(uint256 seed) internal view returns (address) {
        return _users[seed % _users.length];
    }

    /* ------------------ Actions ------------------ */

    function buy(uint256 userSeed, uint32 nRaw) external {
        uint32 n = uint32(bound(nRaw, 1, 20));
        address u = _u(userSeed);

        if (pool.getRoundState(RID) != TicketPrizePoolShmon.RoundState.Open) return;

        (, uint64 salesEndTime,,,,,,,,,,,) = pool.getRoundInfo(RID);
        if (block.timestamp > uint256(salesEndTime)) return;

        vm.prank(u);
        pool.buyTickets{value: uint256(price) * n}(n);
    }

    function warp(uint256 dtRaw) external {
        uint256 dt = bound(dtRaw, 0, 2 days);
        vm.warp(block.timestamp + dt);
    }

    function commit() external {
        if (pool.getRoundState(RID) != TicketPrizePoolShmon.RoundState.Open) return;

        (, uint64 salesEndTime, uint32 totalTickets,,,,,,,,,,) = pool.getRoundInfo(RID);
        if (totalTickets == 0) return;
        if (block.timestamp <= uint256(salesEndTime)) return;

        pool.commitDraw(RID);
    }

    function roll(uint256 blocksRaw) external {
        uint256 b = bound(blocksRaw, 0, 500);
        vm.roll(block.number + b);
    }

    function draw() external {
        if (pool.getRoundState(RID) != TicketPrizePoolShmon.RoundState.Committed) return;

        // IMPORTANT: your getRoundInfo order is:
        // state, salesEndTime, totalTickets, totalPrincipalMON, totalShmonStaked,
        // targetBlockNumber, winner, winningTicket, monReceived, yieldMON, lossRatio, prizeClaimed, settled
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(RID);

        if (block.number <= targetBlockNumber) return;
        if (block.number >= targetBlockNumber + 256) return;

        pool.drawWinner(RID);
    }

    function settle() external {
        if (pool.getRoundState(RID) != TicketPrizePoolShmon.RoundState.Finalizing) return;
        pool.settleRound(RID);
    }

    function claim(uint256 userSeed) external {
        address u = _u(userSeed);
        if (pool.getRoundState(RID) != TicketPrizePoolShmon.RoundState.Settled) return;

        vm.prank(u);
        try pool.claimPrize(RID) {} catch {}
    }

    function withdraw(uint256 userSeed) external {
        address u = _u(userSeed);
        if (pool.getRoundState(RID) != TicketPrizePoolShmon.RoundState.Settled) return;

        vm.prank(u);
        try pool.withdrawPrincipal(RID) {} catch {}
    }
}

/*//////////////////////////////////////////////////////////////
                        INVARIANT SUITE
//////////////////////////////////////////////////////////////*/

contract TicketPrizePoolShmonInvariantTest is StdInvariant, Test {
    TicketPrizePoolShmon pool;
    InvariantStaker staker;
    PoolHandler handler;

    uint96  constant PRICE = 0.01 ether;
    uint32  constant DELAY = 5;
    uint32  constant DUR   = 10 minutes;
    uint256 constant RID   = 1;

    function setUp() public {
        staker = new InvariantStaker();
        pool = new TicketPrizePoolShmon(PRICE, DELAY, DUR, address(staker));

        handler = new PoolHandler(pool, PRICE);

        // Tell Foundry: fuzz-call handler methods
        targetContract(address(handler));
    }

    // 1) Winner must match ownerOfTicket if winner exists
    function invariant_winnerMatchesOwnerIfDrawn() public view {
        (, , uint32 totalTickets, , , , address winner, uint32 winningTicket, , , , , ) = pool.getRoundInfo(RID);

        if (winner == address(0)) return;

        assertTrue(totalTickets > 0);
        assertLt(winningTicket, totalTickets);

        address owner = pool.ownerOfTicket(RID, winningTicket);
        assertEq(owner, winner);
    }

    // 2) Sum(principal of known actors) must never exceed totalPrincipalMON
    function invariant_sumPrincipalNotExceedTotalPrincipal() public view {
        (, , , uint256 totalPrincipalMON, , , , , , , , , ) = pool.getRoundInfo(RID);

        uint256 sum;
        for (uint256 i = 0; i < handler.usersLength(); i++) {
            address u = handler.users(i);
            sum += pool.principalMON(RID, u);
        }

        assertLe(sum, totalPrincipalMON);
    }

    // 3) If round is Settled, pool balance should be >= total principal still claimable + (unclaimed yield)
    // This is a "sanity" invariant; if it fails, you’re leaking funds.
    function invariant_settledHasEnoughForOutstandingPrincipalAndYield() public view {
        (TicketPrizePoolShmon.RoundState state,
         ,
         ,
         uint256 totalPrincipalMON,
         ,
         ,
         address winner,
         ,
         uint256 monReceived,
         uint256 yieldMON,
         ,
         bool prizeClaimed,
         ) = pool.getRoundInfo(RID);

        if (state != TicketPrizePoolShmon.RoundState.Settled) return;

        // outstanding principal = sum of principals over known actors
        uint256 outstandingPrincipal;
        for (uint256 i = 0; i < handler.usersLength(); i++) {
            outstandingPrincipal += pool.principalMON(RID, handler.users(i));
        }

        uint256 outstandingYield = 0;
        if (winner != address(0) && !prizeClaimed) outstandingYield = yieldMON;

        // The pool should have at least what it owes (principal + maybe yield).
        // monReceived is informational; actual enforceable check is contract balance.
        assertGe(address(pool).balance, outstandingPrincipal + outstandingYield);

        // also: monReceived must be >= yieldMON (since yield is computed off monReceived)
        assertGe(monReceived, yieldMON);
    }
}
