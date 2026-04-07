// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePoolShmon.sol";

/// @notice Mock SHMON staker with delayed unstake.
/// IMPORTANT:
/// - stake() mints shares at current exchange rate (no dilution of prior yield)
/// - addYield() increases underlying without minting shares (exchange rate rises)
/// - slash() is ACCOUNTING-ONLY (no ETH sent out)
/// - requestUnstake burns shares and locks pro-rata underlying value
/// - claimUnstake pays out after delay
contract MockShmonStaker is IShmonadStaker {
    uint256 public totalUnderlyingMON;
    uint256 public totalShmonSupply;

    mapping(address => uint256) public shmonBalance;

    uint256 public nextRequestId = 1;
    uint256 public immutable delaySec;

    struct Req {
        uint256 monAmount;
        uint256 readyAt;
        bool claimed;
    }

    mapping(uint256 => Req) public reqs;

    constructor(uint256 _delaySec) {
        delaySec = _delaySec;
    }

    function stake() external payable returns (uint256 shmonAmount) {
        require(msg.value > 0, "no value");

        // Mint shares at current exchange rate to prevent dilution:
        // shares = deposit * totalSupply / totalUnderlying
        // If first deposit: 1:1
        if (totalShmonSupply == 0 || totalUnderlyingMON == 0) {
            shmonAmount = msg.value;
        } else {
            shmonAmount = (msg.value * totalShmonSupply) / totalUnderlyingMON;
            require(shmonAmount > 0, "deposit too small");
        }

        shmonBalance[msg.sender] += shmonAmount;
        totalShmonSupply += shmonAmount;
        totalUnderlyingMON += msg.value;
    }

    function addYield(uint256 amount) external payable {
        uint256 inc = amount + msg.value;
        require(inc > 0, "no yield");
        totalUnderlyingMON += inc;
    }

    /// @notice Simulate loss (accounting-only): reduce underlying, do NOT move ETH.
    /// This keeps claimUnstake payable in tests that don't model real outflow.
    function slash(uint256 amount) external {
        require(amount > 0, "no slash");

        if (amount >= totalUnderlyingMON) {
            totalUnderlyingMON = 0;
        } else {
            totalUnderlyingMON -= amount;
        }
    }

    function requestUnstake(uint256 shmonAmount) external returns (uint256 requestId) {
        require(shmonAmount > 0, "zero");
        require(shmonBalance[msg.sender] >= shmonAmount, "no shmon");
        require(totalShmonSupply > 0, "no supply");
        require(totalUnderlyingMON > 0, "no underlying");

        // pro-rata underlying value
        uint256 monAmount = (shmonAmount * totalUnderlyingMON) / totalShmonSupply;

        // burn shares
        shmonBalance[msg.sender] -= shmonAmount;
        totalShmonSupply -= shmonAmount;

        // lock underlying for this request (remove from pool accounting now)
        require(totalUnderlyingMON >= monAmount, "insolvent");
        totalUnderlyingMON -= monAmount;

        requestId = nextRequestId++;
        reqs[requestId] = Req({monAmount: monAmount, readyAt: block.timestamp + delaySec, claimed: false});
    }

    function isUnstakeReady(uint256 requestId) external view returns (bool) {
        Req memory r = reqs[requestId];
        return (!r.claimed) && r.monAmount > 0 && block.timestamp >= r.readyAt;
    }

    function claimUnstake(uint256 requestId, address to) external returns (uint256 monAmount) {
        Req storage r = reqs[requestId];
        require(!r.claimed, "claimed");
        require(r.monAmount > 0, "bad req");
        require(block.timestamp >= r.readyAt, "not ready");
        require(to != address(0), "bad to");
        require(address(this).balance >= r.monAmount, "insufficient eth");

        r.claimed = true;
        monAmount = r.monAmount;

        (bool ok,) = to.call{value: monAmount}("");
        require(ok, "pay fail");
    }

    receive() external payable {}
}

contract TicketPrizePoolShmonV1Test is Test {
    TicketPrizePoolShmon pool;
    MockShmonStaker staker;

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    function setUp() public {
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        staker = new MockShmonStaker(18 hours);

        pool = new TicketPrizePoolShmon(
            1 ether, // ticketPrice
            5,       // commitDelayBlocks
            1 days,  // roundDuration
            address(staker)
        );
    }
}
