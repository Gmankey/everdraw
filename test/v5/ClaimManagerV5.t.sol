// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ClaimManagerV5} from "../../src/v5/ClaimManagerV5.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract ToggleBlacklistToken is MockERC20 {
    mapping(address => bool) public blacklisted;

    constructor() MockERC20("Blacklisting Token", "BLK", 18) {}

    function setBlacklisted(address account, bool blocked) external {
        blacklisted[account] = blocked;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(!blacklisted[to], "blacklisted");
        _transfer(msg.sender, to, amount);
        return true;
    }
}

contract RejectNative {
    receive() external payable {
        revert("no native");
    }
}

contract NonCanonicalReturnToken is MockERC20 {
    enum ReturnMode {
        Malformed,
        NoReturn,
        False,
        Noncanonical
    }

    ReturnMode public mode;

    constructor() MockERC20("Return Token", "RET", 18) {}

    function setMode(ReturnMode newMode) external {
        mode = newMode;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        if (mode == ReturnMode.NoReturn) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        if (mode == ReturnMode.False) {
            assembly ("memory-safe") {
                mstore(0, 0)
                return(0, 32)
            }
        }
        if (mode == ReturnMode.Noncanonical) {
            assembly ("memory-safe") {
                mstore(0, 2)
                return(0, 32)
            }
        }
        assembly ("memory-safe") {
            mstore(0, 1)
            return(31, 1)
        }
    }
}

contract ClaimManagerV5Test is Test {
    ClaimManagerV5 claims;
    ToggleBlacklistToken token;

    address source = makeAddr("source");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes32 sourceKey = bytes32(uint256(7));

    function setUp() public {
        claims = new ClaimManagerV5();
        token = new ToggleBlacklistToken();
        claims.setAuthorizedSource(source, true);
    }

    function test_ownershipHandoffIsTwoStep() public {
        claims.transferOwnership(alice);
        assertEq(claims.owner(), address(this));
        assertEq(claims.pendingOwner(), alice);

        vm.prank(bob);
        vm.expectRevert(bytes("not pending owner"));
        claims.acceptOwnership();

        vm.prank(alice);
        claims.acceptOwnership();
        assertEq(claims.owner(), alice);
        assertEq(claims.pendingOwner(), address(0));

        vm.expectRevert(ClaimManagerV5.NotOwner.selector);
        claims.setAuthorizedSource(bob, true);
    }

    function test_leafHashBindsVersionChainAndClaimManager() public {
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, alice, address(token), 1 ether);
        bytes32 original = claims.hashLeaf(leaf);
        assertEq(
            original,
            keccak256(
                abi.encode(
                    claims.LEAF_DOMAIN(),
                    uint256(3),
                    block.chainid,
                    address(claims),
                    leaf.distributionId,
                    leaf.leafIndex,
                    leaf.account,
                    leaf.token,
                    leaf.amount,
                    leaf.kind
                )
            )
        );

        ClaimManagerV5 other = new ClaimManagerV5();
        assertEq(claims.CLAIM_LEAF_VERSION(), 3);
        assertTrue(original != other.hashLeaf(leaf));

        vm.chainId(block.chainid + 1);
        assertTrue(original != claims.hashLeaf(leaf));
    }

    function test_onlyAuthorizedSourceCanFundNativeEscrow() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(ClaimManagerV5.NotAuthorizedSource.selector);
        (bool ok,) = address(claims).call{value: 1 ether}("");
        ok;

        _fundNative(1 ether);
        assertEq(address(claims).balance, 1 ether);
    }

    function test_registerAndClaimNativeLeaf() public {
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, alice, address(0), 1 ether);
        bytes32 root = claims.hashLeaf(leaf);
        _fundNative(1 ether);
        _register(root, 1, _nativeTotals(1 ether));

        uint256 beforeBal = alice.balance;
        claims.claim(leaf, new bytes32[](0));

        assertEq(alice.balance, beforeBal + 1 ether);
        assertTrue(claims.isClaimed(leaf.distributionId, leaf.leafIndex));
        assertEq(claims.reservedByToken(address(0)), 0);
    }

    function test_doubleClaimReverts() public {
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, alice, address(0), 1 ether);
        bytes32 root = claims.hashLeaf(leaf);
        _fundNative(1 ether);
        _register(root, 1, _nativeTotals(1 ether));

        claims.claim(leaf, new bytes32[](0));
        vm.expectRevert(ClaimManagerV5.AlreadyClaimed.selector);
        claims.claim(leaf, new bytes32[](0));
    }

    function test_revertingTokenDefersOnlyThatLeafAndDoesNotBlockBatch() public {
        token.mint(address(claims), 30 ether);
        token.setBlacklisted(alice, true);

        ClaimManagerV5.ClaimLeaf memory blocked = _leaf(0, alice, address(token), 10 ether);
        ClaimManagerV5.ClaimLeaf memory good = _leaf(1, bob, address(token), 20 ether);
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = claims.hashLeaf(blocked);
        leaves[1] = claims.hashLeaf(good);
        bytes32 root = _root2(leaves[0], leaves[1]);
        _register(root, 2, _tokenTotals(address(token), 30 ether));

        ClaimManagerV5.ClaimLeaf[] memory batch = new ClaimManagerV5.ClaimLeaf[](2);
        batch[0] = blocked;
        batch[1] = good;
        bytes32[][] memory proofs = new bytes32[][](2);
        proofs[0] = _proof1(leaves[1]);
        proofs[1] = _proof1(leaves[0]);

        claims.claimMany(batch, proofs);

        (,, uint256 deferredAmount,) = claims.deferredClaims(blocked.distributionId, blocked.leafIndex);
        assertEq(deferredAmount, 10 ether);
        assertEq(token.balanceOf(bob), 20 ether);
        assertEq(claims.reservedByToken(address(token)), 10 ether);
    }

    function test_badTokenReturnsDeferWithoutLeakingTokenState() public {
        _assertBadReturnDefers(NonCanonicalReturnToken.ReturnMode.Malformed);
        _assertBadReturnDefers(NonCanonicalReturnToken.ReturnMode.False);
        _assertBadReturnDefers(NonCanonicalReturnToken.ReturnMode.Noncanonical);
    }

    function test_noReturnTokenPaysSuccessfully() public {
        NonCanonicalReturnToken noReturn = new NonCanonicalReturnToken();
        noReturn.setMode(NonCanonicalReturnToken.ReturnMode.NoReturn);
        noReturn.mint(address(claims), 10 ether);
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, alice, address(noReturn), 10 ether);
        _register(claims.hashLeaf(leaf), 1, _tokenTotals(address(noReturn), 10 ether));

        claims.claim(leaf, new bytes32[](0));

        assertEq(noReturn.balanceOf(alice), 10 ether);
        assertEq(claims.reservedByToken(address(noReturn)), 0);
    }

    function test_claimDeferredRetriesUntilPayable() public {
        token.mint(address(claims), 10 ether);
        token.setBlacklisted(alice, true);

        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, alice, address(token), 10 ether);
        _register(claims.hashLeaf(leaf), 1, _tokenTotals(address(token), 10 ether));

        claims.claim(leaf, new bytes32[](0));
        assertEq(claims.reservedByToken(address(token)), 10 ether);

        claims.claimDeferred(leaf.distributionId, leaf.leafIndex);
        assertEq(token.balanceOf(alice), 0);

        token.setBlacklisted(alice, false);
        claims.claimDeferred(leaf.distributionId, leaf.leafIndex);
        assertEq(token.balanceOf(alice), 10 ether);
        assertEq(claims.reservedByToken(address(token)), 0);
    }

    function test_nativeSendFailureDefersByLeaf() public {
        RejectNative receiver = new RejectNative();
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, address(receiver), address(0), 1 ether);
        _fundNative(1 ether);
        _register(claims.hashLeaf(leaf), 1, _nativeTotals(1 ether));

        claims.claim(leaf, new bytes32[](0));

        (address account, address pendingToken, uint256 amount,) =
            claims.deferredClaims(leaf.distributionId, leaf.leafIndex);
        assertEq(account, address(receiver));
        assertEq(pendingToken, address(0));
        assertEq(amount, 1 ether);
        assertEq(claims.reservedByToken(address(0)), 1 ether);
    }

    function test_budgetExceededLeafRevertsEvenWithValidRoot() public {
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, alice, address(0), 2 ether);
        _fundNative(2 ether);
        _register(claims.hashLeaf(leaf), 1, _nativeTotals(1 ether));

        vm.expectRevert(ClaimManagerV5.TokenBudgetExceeded.selector);
        claims.claim(leaf, new bytes32[](0));
    }

    function test_gasProfileClaimFrom10kLeafDistributionDepth() public {
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(9_999, alice, address(0), 1 ether);
        bytes32[] memory proof = new bytes32[](14);
        for (uint256 i = 0; i < proof.length; i++) {
            proof[i] = keccak256(abi.encode("sibling", i));
        }
        bytes32 root = _processProof(claims.hashLeaf(leaf), proof);
        _fundNative(1 ether);
        _register(root, 10_000, _nativeTotals(1 ether));

        claims.claim(leaf, proof);

        assertEq(alice.balance, 1 ether);
    }

    function _assertBadReturnDefers(NonCanonicalReturnToken.ReturnMode mode) internal {
        ClaimManagerV5 isolatedClaims = new ClaimManagerV5();
        isolatedClaims.setAuthorizedSource(source, true);
        NonCanonicalReturnToken badToken = new NonCanonicalReturnToken();
        badToken.setMode(mode);
        badToken.mint(address(isolatedClaims), 10 ether);
        ClaimManagerV5.ClaimLeaf memory leaf = ClaimManagerV5.ClaimLeaf({
            distributionId: isolatedClaims.distributionIdFor(source, sourceKey),
            leafIndex: 0,
            account: alice,
            token: address(badToken),
            amount: 10 ether,
            kind: ClaimManagerV5.ClaimKind.Winner
        });
        ClaimManagerV5.TokenTotal[] memory totals = _tokenTotals(address(badToken), 10 ether);
        bytes32 root = isolatedClaims.hashLeaf(leaf);
        vm.prank(source);
        isolatedClaims.registerDistribution(sourceKey, root, 1, totals, bytes32("bad-return"));

        isolatedClaims.claim(leaf, new bytes32[](0));

        (,, uint256 deferredAmount,) = isolatedClaims.deferredClaims(leaf.distributionId, leaf.leafIndex);
        assertEq(deferredAmount, 10 ether);
        assertEq(badToken.balanceOf(alice), 0, "isolated call must roll back token state");
        assertEq(badToken.balanceOf(address(isolatedClaims)), 10 ether);
    }

    function _register(bytes32 root, uint32 leafCount, ClaimManagerV5.TokenTotal[] memory totals) internal {
        vm.prank(source);
        claims.registerDistribution(sourceKey, root, leafCount, totals, bytes32("metadata"));
    }

    function _leaf(uint256 leafIndex, address account, address claimToken, uint256 amount)
        internal
        view
        returns (ClaimManagerV5.ClaimLeaf memory)
    {
        return ClaimManagerV5.ClaimLeaf({
            distributionId: claims.distributionIdFor(source, sourceKey),
            leafIndex: leafIndex,
            account: account,
            token: claimToken,
            amount: amount,
            kind: ClaimManagerV5.ClaimKind.Winner
        });
    }

    function _fundNative(uint256 amount) internal {
        vm.deal(source, amount);
        vm.prank(source);
        (bool ok,) = address(claims).call{value: amount}("");
        require(ok, "fund failed");
    }

    function _nativeTotals(uint256 amount) internal pure returns (ClaimManagerV5.TokenTotal[] memory totals) {
        totals = new ClaimManagerV5.TokenTotal[](1);
        totals[0] = ClaimManagerV5.TokenTotal({token: address(0), amount: amount});
    }

    function _tokenTotals(address claimToken, uint256 amount)
        internal
        pure
        returns (ClaimManagerV5.TokenTotal[] memory totals)
    {
        totals = new ClaimManagerV5.TokenTotal[](1);
        totals[0] = ClaimManagerV5.TokenTotal({token: claimToken, amount: amount});
    }

    function _proof1(bytes32 sibling) internal pure returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = sibling;
    }

    function _root2(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _processProof(bytes32 leaf, bytes32[] memory proof) internal pure returns (bytes32 computed) {
        computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computed = _root2(computed, proof[i]);
        }
    }
}

contract ClaimManagerV5InvariantHandler is Test {
    ClaimManagerV5 public immutable claims;
    ToggleBlacklistToken public immutable token;
    bytes32 public immutable distributionId;
    bytes32 public immutable sourceKey;

    address public constant ALICE = address(0xA11CE);
    address public constant BOB = address(0xB0B);
    address public constant BLOCKED = address(0xB10C);
    address public constant CAROL = address(0xCA901);

    constructor(ClaimManagerV5 _claims, ToggleBlacklistToken _token, bytes32 _sourceKey) {
        claims = _claims;
        token = _token;
        sourceKey = _sourceKey;
        distributionId = claims.distributionIdFor(address(this), sourceKey);
    }

    function claim(uint8 indexSeed) external {
        uint256 index = indexSeed % 4;
        (ClaimManagerV5.ClaimLeaf memory leaf, bytes32[] memory proof) = leafAndProof(index);
        try claims.claim(leaf, proof) {} catch {}
    }

    function retryDeferred(uint8 indexSeed) external {
        uint256 index = indexSeed % 4;
        try claims.claimDeferred(distributionId, index) {} catch {}
    }

    function setBlocked(bool blocked) external {
        token.setBlacklisted(BLOCKED, blocked);
    }

    function register(ClaimManagerV5.TokenTotal[] calldata totals) external {
        claims.registerDistribution(sourceKey, this.root(), 4, totals, bytes32("invariant"));
    }

    function leafAndProof(uint256 index)
        public
        view
        returns (ClaimManagerV5.ClaimLeaf memory leaf, bytes32[] memory proof)
    {
        leaf = leafAt(index);
        bytes32[4] memory leafHashes = leafHashArray();
        proof = new bytes32[](2);

        if (index == 0) {
            proof[0] = leafHashes[1];
            proof[1] = root2(leafHashes[2], leafHashes[3]);
        } else if (index == 1) {
            proof[0] = leafHashes[0];
            proof[1] = root2(leafHashes[2], leafHashes[3]);
        } else if (index == 2) {
            proof[0] = leafHashes[3];
            proof[1] = root2(leafHashes[0], leafHashes[1]);
        } else {
            proof[0] = leafHashes[2];
            proof[1] = root2(leafHashes[0], leafHashes[1]);
        }
    }

    function root() external view returns (bytes32) {
        bytes32[4] memory leafHashes = leafHashArray();
        return root2(root2(leafHashes[0], leafHashes[1]), root2(leafHashes[2], leafHashes[3]));
    }

    function leafAt(uint256 index) public view returns (ClaimManagerV5.ClaimLeaf memory) {
        if (index == 0) return _leaf(0, ALICE, 10 ether);
        if (index == 1) return _leaf(1, BOB, 20 ether);
        if (index == 2) return _leaf(2, BLOCKED, 30 ether);
        return _leaf(3, CAROL, 40 ether);
    }

    function leafHashArray() public view returns (bytes32[4] memory leafHashes) {
        for (uint256 i = 0; i < 4; i++) {
            leafHashes[i] = claims.hashLeaf(leafAt(i));
        }
    }

    function root2(bytes32 a, bytes32 b) public pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _leaf(uint256 index, address account, uint256 amount)
        internal
        view
        returns (ClaimManagerV5.ClaimLeaf memory)
    {
        return ClaimManagerV5.ClaimLeaf({
            distributionId: distributionId,
            leafIndex: index,
            account: account,
            token: address(token),
            amount: amount,
            kind: ClaimManagerV5.ClaimKind.Winner
        });
    }
}

contract ClaimManagerV5FuzzTest is Test {
    ClaimManagerV5 claims;
    ToggleBlacklistToken token;
    ClaimManagerV5InvariantHandler handler;

    bytes32 sourceKey = bytes32(uint256(99));
    uint256 constant TOTAL = 100 ether;

    function setUp() public {
        claims = new ClaimManagerV5();
        token = new ToggleBlacklistToken();
        handler = new ClaimManagerV5InvariantHandler(claims, token, sourceKey);

        claims.setAuthorizedSource(address(handler), true);
        token.mint(address(claims), TOTAL);
        token.setBlacklisted(handler.BLOCKED(), true);

        ClaimManagerV5.TokenTotal[] memory totals = new ClaimManagerV5.TokenTotal[](1);
        totals[0] = ClaimManagerV5.TokenTotal({token: address(token), amount: TOTAL});
        handler.register(totals);

        _assertAccountingBounds();
    }

    function testFuzz_claimAccountingBoundsAcrossClaimRetrySequences(
        uint8[32] calldata opSeeds,
        bool[32] calldata blockedFlags
    ) public {
        for (uint256 i = 0; i < opSeeds.length; i++) {
            handler.setBlocked(blockedFlags[i]);
            if (opSeeds[i] & 1 == 0) {
                handler.claim(opSeeds[i]);
            } else {
                handler.retryDeferred(opSeeds[i]);
            }
            _assertAccountingBounds();
        }
    }

    function _assertAccountingBounds() internal view {
        assertLe(claims.distributionTokenAccounted(handler.distributionId(), address(token)), TOTAL);
        assertEq(claims.reservedByToken(address(token)), token.balanceOf(address(claims)));
        uint256 paid = token.balanceOf(handler.ALICE()) + token.balanceOf(handler.BOB())
            + token.balanceOf(handler.BLOCKED()) + token.balanceOf(handler.CAROL());
        assertEq(paid + token.balanceOf(address(claims)), TOTAL);
    }
}
