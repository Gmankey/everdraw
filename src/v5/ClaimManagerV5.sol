// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

interface IERC20ClaimManagerV5 {
    function balanceOf(address account) external view returns (uint256);
}

/// @title ClaimManagerV5
/// @notice Generalized V5 payout substrate for merkle distributions.
contract ClaimManagerV5 {
    bytes32 public constant LEAF_DOMAIN = keccak256("everdraw-v5-claim-leaf/1");
    address public constant NATIVE_TOKEN = address(0);

    struct TokenTotal {
        address token;
        uint256 amount;
    }

    struct Distribution {
        address source;
        bytes32 sourceKey;
        bytes32 root;
        uint32 leafCount;
        bytes32 metadata;
        uint64 registeredAt;
    }

    struct ClaimLeaf {
        bytes32 distributionId;
        uint256 leafIndex;
        address account;
        address token;
        uint256 amount;
    }

    struct DeferredClaim {
        address account;
        address token;
        uint256 amount;
    }

    address public owner;
    address public pendingOwner;
    uint256 private _locked = 1;

    mapping(address => bool) public authorizedSource;
    mapping(bytes32 => Distribution) public distributions;
    mapping(bytes32 => mapping(address => uint256)) public distributionTokenTotal;
    mapping(bytes32 => mapping(address => uint256)) public distributionTokenAccounted;
    mapping(address => uint256) public reservedByToken;
    mapping(bytes32 => mapping(uint256 => uint256)) private claimedBitmaps;
    mapping(bytes32 => mapping(uint256 => DeferredClaim)) public deferredClaims;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SourceAuthorizationSet(address indexed source, bool authorized);
    event DistributionRegistered(
        bytes32 indexed distributionId,
        address indexed source,
        bytes32 indexed sourceKey,
        bytes32 root,
        uint32 leafCount,
        bytes32 metadata
    );
    event ClaimPaid(
        bytes32 indexed distributionId,
        uint256 indexed leafIndex,
        address indexed account,
        address token,
        uint256 amount
    );
    event ClaimDeferred(
        bytes32 indexed distributionId,
        uint256 indexed leafIndex,
        address indexed account,
        address token,
        uint256 amount
    );
    event DeferredClaimPaid(
        bytes32 indexed distributionId,
        uint256 indexed leafIndex,
        address indexed account,
        address token,
        uint256 amount
    );

    error NotOwner();
    error NotAuthorizedSource();
    error ZeroAddress();
    error BadDistribution();
    error DistributionExists();
    error DistributionNotFound();
    error BadLeaf();
    error AlreadyClaimed();
    error InvalidProof();
    error TokenBudgetExceeded();
    error InsufficientEscrow(address token, uint256 required, uint256 available);
    error NothingDeferred();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    receive() external payable {}

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    function setAuthorizedSource(address source, bool authorized) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        authorizedSource[source] = authorized;
        emit SourceAuthorizationSet(source, authorized);
    }

    function distributionIdFor(address source, bytes32 sourceKey) public pure returns (bytes32) {
        return keccak256(abi.encode(source, sourceKey));
    }

    function hashLeaf(ClaimLeaf memory leaf) public pure returns (bytes32) {
        return keccak256(
            abi.encode(LEAF_DOMAIN, leaf.distributionId, leaf.leafIndex, leaf.account, leaf.token, leaf.amount)
        );
    }

    function isClaimed(bytes32 distributionId, uint256 leafIndex) public view returns (bool) {
        uint256 wordIndex = leafIndex >> 8;
        uint256 bitIndex = leafIndex & 0xff;
        return (claimedBitmaps[distributionId][wordIndex] & (uint256(1) << bitIndex)) != 0;
    }

    function registerDistribution(
        bytes32 sourceKey,
        bytes32 root,
        uint32 leafCount,
        TokenTotal[] calldata totals,
        bytes32 metadata
    ) external nonReentrant returns (bytes32 distributionId) {
        if (!authorizedSource[msg.sender]) revert NotAuthorizedSource();
        if (sourceKey == bytes32(0) || root == bytes32(0) || leafCount == 0 || totals.length == 0) {
            revert BadDistribution();
        }

        distributionId = distributionIdFor(msg.sender, sourceKey);
        if (distributions[distributionId].registeredAt != 0) revert DistributionExists();

        for (uint256 i = 0; i < totals.length; i++) {
            address token = totals[i].token;
            uint256 amount = totals[i].amount;
            if (amount == 0) revert BadDistribution();
            if (distributionTokenTotal[distributionId][token] != 0) revert BadDistribution();

            uint256 available = _escrowBalance(token) - reservedByToken[token];
            if (amount > available) revert InsufficientEscrow(token, amount, available);

            distributionTokenTotal[distributionId][token] = amount;
            reservedByToken[token] += amount;
        }

        distributions[distributionId] = Distribution({
            source: msg.sender,
            sourceKey: sourceKey,
            root: root,
            leafCount: leafCount,
            metadata: metadata,
            registeredAt: uint64(block.timestamp)
        });

        emit DistributionRegistered(distributionId, msg.sender, sourceKey, root, leafCount, metadata);
    }

    function claim(ClaimLeaf calldata leaf, bytes32[] calldata proof) external nonReentrant {
        _claim(leaf, proof);
    }

    function claimMany(ClaimLeaf[] calldata leaves, bytes32[][] calldata proofs) external nonReentrant {
        if (leaves.length != proofs.length) revert BadLeaf();
        for (uint256 i = 0; i < leaves.length; i++) {
            _claim(leaves[i], proofs[i]);
        }
    }

    function claimDeferred(bytes32 distributionId, uint256 leafIndex) external nonReentrant {
        DeferredClaim memory pending = deferredClaims[distributionId][leafIndex];
        if (pending.account == address(0)) revert NothingDeferred();

        if (_tryPay(pending.token, pending.account, pending.amount)) {
            delete deferredClaims[distributionId][leafIndex];
            reservedByToken[pending.token] -= pending.amount;
            emit DeferredClaimPaid(distributionId, leafIndex, pending.account, pending.token, pending.amount);
        }
    }

    function claimDeferredMany(bytes32[] calldata distributionIds, uint256[] calldata leafIndexes)
        external
        nonReentrant
    {
        if (distributionIds.length != leafIndexes.length) revert BadLeaf();
        for (uint256 i = 0; i < distributionIds.length; i++) {
            DeferredClaim memory pending = deferredClaims[distributionIds[i]][leafIndexes[i]];
            if (pending.account == address(0)) continue;
            if (_tryPay(pending.token, pending.account, pending.amount)) {
                delete deferredClaims[distributionIds[i]][leafIndexes[i]];
                reservedByToken[pending.token] -= pending.amount;
                emit DeferredClaimPaid(
                    distributionIds[i],
                    leafIndexes[i],
                    pending.account,
                    pending.token,
                    pending.amount
                );
            }
        }
    }

    function _claim(ClaimLeaf calldata leaf, bytes32[] calldata proof) internal {
        Distribution memory distribution = distributions[leaf.distributionId];
        if (distribution.registeredAt == 0) revert DistributionNotFound();
        if (leaf.account == address(0) || leaf.amount == 0 || leaf.leafIndex >= distribution.leafCount) {
            revert BadLeaf();
        }
        if (isClaimed(leaf.distributionId, leaf.leafIndex)) revert AlreadyClaimed();
        if (!_verify(proof, distribution.root, hashLeaf(leaf))) revert InvalidProof();

        _setClaimed(leaf.distributionId, leaf.leafIndex);

        uint256 accounted = distributionTokenAccounted[leaf.distributionId][leaf.token] + leaf.amount;
        if (accounted > distributionTokenTotal[leaf.distributionId][leaf.token]) revert TokenBudgetExceeded();
        distributionTokenAccounted[leaf.distributionId][leaf.token] = accounted;

        if (_tryPay(leaf.token, leaf.account, leaf.amount)) {
            reservedByToken[leaf.token] -= leaf.amount;
            emit ClaimPaid(leaf.distributionId, leaf.leafIndex, leaf.account, leaf.token, leaf.amount);
        } else {
            deferredClaims[leaf.distributionId][leaf.leafIndex] =
                DeferredClaim({account: leaf.account, token: leaf.token, amount: leaf.amount});
            emit ClaimDeferred(leaf.distributionId, leaf.leafIndex, leaf.account, leaf.token, leaf.amount);
        }
    }

    function _setClaimed(bytes32 distributionId, uint256 leafIndex) internal {
        uint256 wordIndex = leafIndex >> 8;
        uint256 bitIndex = leafIndex & 0xff;
        claimedBitmaps[distributionId][wordIndex] |= uint256(1) << bitIndex;
    }

    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            computed = computed < proofElement
                ? keccak256(abi.encodePacked(computed, proofElement))
                : keccak256(abi.encodePacked(proofElement, computed));
        }
        return computed == root;
    }

    function _tryPay(address token, address to, uint256 amount) internal returns (bool) {
        if (token == NATIVE_TOKEN) {
            (bool nativeOk,) = to.call{value: amount}("");
            return nativeOk;
        }

        (bool tokenOk, bytes memory data) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        return tokenOk && (data.length == 0 || abi.decode(data, (bool)));
    }

    function _escrowBalance(address token) internal view returns (uint256) {
        if (token == NATIVE_TOKEN) return address(this).balance;
        return IERC20ClaimManagerV5(token).balanceOf(address(this));
    }
}
