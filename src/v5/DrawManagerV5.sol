// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IRandomnessOracle} from "../interfaces/IRandomnessOracle.sol";
import {IRandomnessOracleConsumer} from "../interfaces/IRandomnessOracleConsumer.sol";
import {PrizeVaultV5} from "./PrizeVaultV5.sol";
import {EverdrawTwabController} from "./twab/EverdrawTwabController.sol";

/// @title DrawManagerV5
/// @notice V5 draw lifecycle: fixed-period cadence, VRF seed, root proposal, veto, finalize.
contract DrawManagerV5 is IRandomnessOracleConsumer {
    uint64 public constant ORACLE_CHANGE_DELAY = 24 hours;
    bytes32 public constant ALGORITHM_VERSION_HASH = keccak256("everdraw-v5-draw-algorithm/1");

    enum DrawStatus {
        None,
        AwaitingSeed,
        Seeded,
        Proposed,
        Finalized,
        Skipped
    }

    struct Draw {
        uint64 periodStart;
        uint64 periodEnd;
        uint64 randomnessRequestId;
        bytes32 seed;
        uint256 totalTwab;
        uint256 totalPayout;
        uint32 winnerCount;
        bytes32 root;
        uint64 proposedAt;
        address proposer;
        DrawStatus status;
    }

    PrizeVaultV5 public immutable vault;
    EverdrawTwabController public immutable twabController;
    address public immutable claimManager;

    address public owner;
    address public pendingOwner;
    address public guardian;
    address public primaryProposer;
    IRandomnessOracle public randomnessOracle;
    address public pendingOracle;
    uint64 public pendingOracleEffectiveAt;

    uint64 public drawPeriod;
    uint64 public nextPeriodStart;
    uint64 public proposerGracePeriod;
    uint64 public challengeWindow;
    uint64 public vetoCooldown;
    uint256 public minPrizeThreshold;
    uint256 public currentDrawId;

    mapping(uint256 => Draw) public draws;
    mapping(uint64 => uint256) public drawIdByRequestId;
    mapping(uint256 => uint64) public vetoedUntil;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event GuardianSet(address indexed guardian);
    event PrimaryProposerSet(address indexed primaryProposer);
    event TimingUpdated(uint64 proposerGracePeriod, uint64 challengeWindow, uint64 vetoCooldown);
    event MinPrizeThresholdUpdated(uint256 minPrizeThreshold);
    event DrawPeriodChangeQueued(uint64 drawPeriod, uint64 effectiveAt);
    event OracleChangeQueued(address indexed oracle, uint64 effectiveAt);
    event OracleChanged(address indexed oracle);
    event OracleChangeCancelled();
    event DrawStarted(
        uint256 indexed drawId,
        uint64 periodStart,
        uint64 periodEnd,
        uint256 totalTwab,
        uint256 totalPayout,
        uint64 requestId
    );
    event DrawSkipped(
        uint256 indexed drawId,
        uint64 periodStart,
        uint64 periodEnd,
        uint256 totalTwab,
        uint256 availablePrize,
        string reason
    );
    event SeedReceived(uint256 indexed drawId, uint64 indexed requestId, bytes32 seed);
    event RootProposed(
        uint256 indexed drawId,
        bytes32 indexed root,
        uint32 winnerCount,
        uint256 totalPayout,
        address indexed proposer,
        bytes32 algorithmVersion,
        uint64 challengeEndsAt
    );
    event RootVetoed(uint256 indexed drawId, bytes32 indexed root, address indexed guardian, uint64 proposeAfter);
    event RootFinalized(uint256 indexed drawId, bytes32 indexed root, uint32 winnerCount, uint256 totalPayout);

    error NotOwner();
    error NotGuardian();
    error ZeroAddress();
    error BadConfig();
    error PeriodNotEnded();
    error DrawNotSeeded();
    error DrawNotProposed();
    error DrawAlreadyFinalized();
    error ActiveProposal();
    error ProposerGraceActive();
    error ChallengeWindowActive();
    error VetoCooldownActive(uint64 proposeAfter);
    error BadPayout(uint256 expected, uint256 actual);
    error BadRoot();
    error UnknownRequest();
    error NotOracle();
    error NoPendingOracleChange();
    error TimelockNotElapsed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(
        address _vault,
        address _twabController,
        address _claimManager,
        address _randomnessOracle,
        address _guardian,
        address _primaryProposer,
        uint64 _firstPeriodStart,
        uint64 _drawPeriod,
        uint64 _proposerGracePeriod,
        uint64 _challengeWindow
    ) {
        if (
            _vault == address(0) || _twabController == address(0) || _claimManager == address(0)
                || _randomnessOracle == address(0) || _guardian == address(0)
        ) revert ZeroAddress();
        if (_drawPeriod == 0 || _challengeWindow == 0) revert BadConfig();

        owner = msg.sender;
        guardian = _guardian;
        primaryProposer = _primaryProposer;
        vault = PrizeVaultV5(payable(_vault));
        twabController = EverdrawTwabController(_twabController);
        claimManager = _claimManager;
        randomnessOracle = IRandomnessOracle(_randomnessOracle);
        nextPeriodStart = _firstPeriodStart;
        drawPeriod = _drawPeriod;
        proposerGracePeriod = _proposerGracePeriod;
        challengeWindow = _challengeWindow;
        vetoCooldown = 1 hours;

        emit OwnershipTransferred(address(0), msg.sender);
        emit GuardianSet(_guardian);
        emit PrimaryProposerSet(_primaryProposer);
        emit TimingUpdated(_proposerGracePeriod, _challengeWindow, vetoCooldown);
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

    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert ZeroAddress();
        guardian = newGuardian;
        emit GuardianSet(newGuardian);
    }

    function setPrimaryProposer(address newPrimaryProposer) external onlyOwner {
        primaryProposer = newPrimaryProposer;
        emit PrimaryProposerSet(newPrimaryProposer);
    }

    function setTiming(uint64 newProposerGracePeriod, uint64 newChallengeWindow, uint64 newVetoCooldown)
        external
        onlyOwner
    {
        if (newChallengeWindow == 0) revert BadConfig();
        proposerGracePeriod = newProposerGracePeriod;
        challengeWindow = newChallengeWindow;
        vetoCooldown = newVetoCooldown;
        emit TimingUpdated(newProposerGracePeriod, newChallengeWindow, newVetoCooldown);
    }

    function setMinPrizeThreshold(uint256 newMinPrizeThreshold) external onlyOwner {
        minPrizeThreshold = newMinPrizeThreshold;
        emit MinPrizeThresholdUpdated(newMinPrizeThreshold);
    }

    function queueOracleChange(address newOracle) external onlyOwner {
        if (newOracle == address(0) || newOracle.code.length == 0) revert ZeroAddress();
        pendingOracle = newOracle;
        pendingOracleEffectiveAt = uint64(block.timestamp + ORACLE_CHANGE_DELAY);
        emit OracleChangeQueued(newOracle, pendingOracleEffectiveAt);
    }

    function commitOracleChange() external onlyOwner {
        if (pendingOracleEffectiveAt == 0) revert NoPendingOracleChange();
        if (block.timestamp < pendingOracleEffectiveAt) revert TimelockNotElapsed();
        randomnessOracle = IRandomnessOracle(pendingOracle);
        pendingOracle = address(0);
        pendingOracleEffectiveAt = 0;
        emit OracleChanged(address(randomnessOracle));
    }

    function cancelOracleChange() external onlyOwner {
        if (pendingOracleEffectiveAt == 0) revert NoPendingOracleChange();
        pendingOracle = address(0);
        pendingOracleEffectiveAt = 0;
        emit OracleChangeCancelled();
    }

    function startDraw() external payable returns (uint256 drawId) {
        uint64 periodStart = nextPeriodStart;
        uint64 periodEnd = periodStart + drawPeriod;
        if (block.timestamp < periodEnd) revert PeriodNotEnded();

        drawId = ++currentDrawId;
        nextPeriodStart = periodEnd;

        uint256 totalTwab = twabController.getTotalTwabBetween(address(vault), periodStart, periodEnd);
        uint256 availablePrize = vault.availableYield();

        if (totalTwab == 0) {
            _recordSkip(drawId, periodStart, periodEnd, totalTwab, availablePrize, "ZERO_TWAB");
            return drawId;
        }
        if (availablePrize < minPrizeThreshold || availablePrize == 0) {
            _recordSkip(drawId, periodStart, periodEnd, totalTwab, availablePrize, "ZERO_PRIZE");
            return drawId;
        }

        vault.escrowYield(claimManager, availablePrize);
        uint128 fee = randomnessOracle.getFee();
        require(msg.value >= fee, "insufficient oracle fee");
        uint64 requestId = randomnessOracle.requestRandomness{value: fee}(abi.encode(bytes32(drawId)));
        if (msg.value > fee) {
            (bool ok,) = msg.sender.call{value: msg.value - fee}("");
            require(ok, "refund failed");
        }

        Draw storage draw = draws[drawId];
        draw.periodStart = periodStart;
        draw.periodEnd = periodEnd;
        draw.randomnessRequestId = requestId;
        draw.totalTwab = totalTwab;
        draw.totalPayout = availablePrize;
        draw.status = DrawStatus.AwaitingSeed;
        drawIdByRequestId[requestId] = drawId;

        emit DrawStarted(drawId, periodStart, periodEnd, totalTwab, availablePrize, requestId);
    }

    function onRandomnessReceived(uint64 requestId, bytes32 randomNumber) external {
        if (msg.sender != address(randomnessOracle)) revert NotOracle();
        uint256 drawId = drawIdByRequestId[requestId];
        if (drawId == 0) revert UnknownRequest();

        Draw storage draw = draws[drawId];
        if (draw.status != DrawStatus.AwaitingSeed) revert BadConfig();
        draw.seed = randomNumber;
        draw.status = DrawStatus.Seeded;
        emit SeedReceived(drawId, requestId, randomNumber);
    }

    function proposeRoot(uint256 drawId, bytes32 root, uint32 winnerCount, uint256 totalPayout) external {
        if (root == bytes32(0) || winnerCount == 0) revert BadRoot();
        Draw storage draw = draws[drawId];
        if (draw.status != DrawStatus.Seeded) revert DrawNotSeeded();
        if (vetoedUntil[drawId] > block.timestamp) revert VetoCooldownActive(vetoedUntil[drawId]);
        if (draw.root != bytes32(0)) revert ActiveProposal();
        if (primaryProposer != address(0) && msg.sender != primaryProposer) {
            uint256 graceEndsAt = uint256(draw.periodEnd) + proposerGracePeriod;
            if (block.timestamp < graceEndsAt) revert ProposerGraceActive();
        }
        if (totalPayout != draw.totalPayout) revert BadPayout(draw.totalPayout, totalPayout);

        draw.root = root;
        draw.winnerCount = winnerCount;
        draw.proposedAt = uint64(block.timestamp);
        draw.proposer = msg.sender;
        draw.status = DrawStatus.Proposed;

        emit RootProposed(
            drawId,
            root,
            winnerCount,
            totalPayout,
            msg.sender,
            ALGORITHM_VERSION_HASH,
            uint64(block.timestamp + challengeWindow)
        );
    }

    function vetoRoot(uint256 drawId) external onlyGuardian {
        Draw storage draw = draws[drawId];
        if (draw.status == DrawStatus.Finalized) revert DrawAlreadyFinalized();
        if (draw.status != DrawStatus.Proposed) revert DrawNotProposed();

        bytes32 oldRoot = draw.root;
        draw.root = bytes32(0);
        draw.winnerCount = 0;
        draw.proposedAt = 0;
        draw.proposer = address(0);
        draw.status = DrawStatus.Seeded;
        vetoedUntil[drawId] = uint64(block.timestamp + vetoCooldown);

        emit RootVetoed(drawId, oldRoot, msg.sender, vetoedUntil[drawId]);
    }

    function finalizeRoot(uint256 drawId) external {
        Draw storage draw = draws[drawId];
        if (draw.status != DrawStatus.Proposed) revert DrawNotProposed();
        if (block.timestamp < uint256(draw.proposedAt) + challengeWindow) revert ChallengeWindowActive();

        draw.status = DrawStatus.Finalized;
        emit RootFinalized(drawId, draw.root, draw.winnerCount, draw.totalPayout);
    }

    function _recordSkip(
        uint256 drawId,
        uint64 periodStart,
        uint64 periodEnd,
        uint256 totalTwab,
        uint256 availablePrize,
        string memory reason
    ) internal {
        Draw storage draw = draws[drawId];
        draw.periodStart = periodStart;
        draw.periodEnd = periodEnd;
        draw.totalTwab = totalTwab;
        draw.status = DrawStatus.Skipped;
        emit DrawSkipped(drawId, periodStart, periodEnd, totalTwab, availablePrize, reason);
    }
}
