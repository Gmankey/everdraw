// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IRandomnessOracle} from "../interfaces/IRandomnessOracle.sol";
import {IRandomnessOracleConsumer} from "../interfaces/IRandomnessOracleConsumer.sol";
import {ClaimManagerV5} from "./ClaimManagerV5.sol";
import {PrizeVaultV5} from "./PrizeVaultV5.sol";
import {EverdrawTwabController} from "./twab/EverdrawTwabController.sol";

interface IERC20DrawManagerV5 {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title DrawManagerV5
/// @notice V5 draw lifecycle: fixed-period cadence, VRF seed, root proposal, veto, finalize.
contract DrawManagerV5 is IRandomnessOracleConsumer {
    uint64 public constant ORACLE_CHANGE_DELAY = 24 hours;
    bytes32 public constant ALGORITHM_VERSION_HASH = keccak256("everdraw-v5-draw-algorithm/1");
    uint16 public constant MAX_FEE_BPS = 2_000;
    uint8 public constant MAX_FEE_RECIPIENTS = 8;
    address public constant NATIVE_TOKEN = address(0);

    enum FeeBase {
        TOTAL_PRIZE,
        PARTICIPANT_YIELD_ONLY
    }

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
        uint32 rewardLegCount;
        bytes32 root;
        uint64 proposedAt;
        address proposer;
        DrawStatus status;
        uint256 grossYield;
        uint256 sponsorYield;
        uint256 feeAmount;
    }

    struct FeeRecipient {
        address account;
        uint16 bps;
    }

    struct RewardSchedule {
        address funder;
        address token;
        uint256 amountPerDraw;
        uint32 startDrawId;
        uint32 remainingDraws;
        bool cancelled;
    }

    struct RewardLeg {
        address token;
        uint256 amount;
    }

    PrizeVaultV5 public immutable vault;
    EverdrawTwabController public immutable twabController;
    ClaimManagerV5 public immutable claimManager;

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
    uint64 public seedRequestTimeout;
    uint256 public minPrizeThreshold;
    uint256 public currentDrawId;
    FeeBase public feeBase;
    uint16 public totalFeeBps;
    uint256 public nextRewardScheduleId;

    mapping(uint256 => Draw) public draws;
    mapping(uint64 => uint256) public drawIdByRequestId;
    mapping(uint256 => uint64) public seedRequestedAt;
    mapping(uint256 => uint64) public vetoedUntil;
    mapping(address => bool) public rewardTokenAllowed;
    mapping(uint256 => RewardSchedule) public rewardSchedules;
    mapping(uint256 => RewardLeg[]) internal drawRewardLegs;
    mapping(uint256 => FeeRecipient[]) internal drawFeeRecipients;
    mapping(uint256 => uint16) internal drawTotalFeeBps;
    FeeRecipient[] internal feeRecipients;

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
    event SeedRequestTimeoutUpdated(uint64 seedRequestTimeout);
    event SeedRerequested(uint256 indexed drawId, uint64 oldRequestId, uint64 newRequestId);
    event FeeConfigUpdated(FeeBase feeBase, uint16 totalFeeBps);
    event FeeRecipientsUpdated(uint16 totalFeeBps);
    event RewardTokenAllowedSet(address indexed token, bool allowed);
    event PrizeFunded(
        uint256 indexed scheduleId,
        address indexed funder,
        address indexed token,
        uint256 amountPerDraw,
        uint32 startDrawId,
        uint32 drawCount
    );
    event PrizeFundingCancelled(uint256 indexed scheduleId, address indexed funder, uint256 refunded);
    event DrawEconomicsSnapshot(
        uint256 indexed drawId, uint256 grossYield, uint256 sponsorYield, uint256 feeAmount, uint256 totalPayout
    );

    error NotOwner();
    error NotGuardian();
    error ZeroAddress();
    error BadConfig();
    error PeriodNotEnded();
    error DrawNotSeeded();
    error DrawNotProposed();
    error DrawAlreadyFinalized();
    error ActiveProposal();
    error SeedRequestStillActive(uint64 retryAfter);
    error ProposerGraceActive();
    error ChallengeWindowActive();
    error VetoCooldownActive(uint64 proposeAfter);
    error BadPayout(uint256 expected, uint256 actual);
    error BadRoot();
    error UnknownRequest();
    error NotOracle();
    error NoPendingOracleChange();
    error TimelockNotElapsed();
    error BadFeeConfig();
    error TokenNotAllowed();
    error BadFunding();
    error NotFunder();
    error BadTwabPeriodAlignment(
        uint64 firstPeriodStart, uint64 drawPeriod, uint32 twabPeriodLength, uint32 twabPeriodOffset
    );

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

        EverdrawTwabController twab = EverdrawTwabController(_twabController);
        uint32 twabPeriodLength = twab.periodLength();
        if (_drawPeriod % twabPeriodLength != 0 || twab.periodEndOnOrAfter(_firstPeriodStart) != _firstPeriodStart) {
            revert BadTwabPeriodAlignment(_firstPeriodStart, _drawPeriod, twabPeriodLength, twab.periodOffset());
        }

        owner = msg.sender;
        guardian = _guardian;
        primaryProposer = _primaryProposer;
        vault = PrizeVaultV5(payable(_vault));
        twabController = twab;
        claimManager = ClaimManagerV5(payable(_claimManager));
        randomnessOracle = IRandomnessOracle(_randomnessOracle);
        nextPeriodStart = _firstPeriodStart;
        drawPeriod = _drawPeriod;
        proposerGracePeriod = _proposerGracePeriod;
        challengeWindow = _challengeWindow;
        vetoCooldown = 1 hours;
        seedRequestTimeout = 1 hours;

        emit OwnershipTransferred(address(0), msg.sender);
        emit GuardianSet(_guardian);
        emit PrimaryProposerSet(_primaryProposer);
        emit TimingUpdated(_proposerGracePeriod, _challengeWindow, vetoCooldown);
        emit SeedRequestTimeoutUpdated(seedRequestTimeout);
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

    function setSeedRequestTimeout(uint64 newSeedRequestTimeout) external onlyOwner {
        if (newSeedRequestTimeout == 0) revert BadConfig();
        seedRequestTimeout = newSeedRequestTimeout;
        emit SeedRequestTimeoutUpdated(newSeedRequestTimeout);
    }

    function setFeeConfig(FeeBase newFeeBase, address[] calldata recipients, uint16[] calldata bps) external onlyOwner {
        if (recipients.length != bps.length || recipients.length > MAX_FEE_RECIPIENTS) revert BadFeeConfig();
        delete feeRecipients;
        uint256 sum;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0) || bps[i] == 0) revert BadFeeConfig();
            sum += bps[i];
            feeRecipients.push(FeeRecipient({account: recipients[i], bps: bps[i]}));
        }
        if (sum > MAX_FEE_BPS) revert BadFeeConfig();
        feeBase = newFeeBase;
        totalFeeBps = uint16(sum);
        emit FeeConfigUpdated(newFeeBase, uint16(sum));
        emit FeeRecipientsUpdated(uint16(sum));
    }

    function setRewardTokenAllowed(address token, bool allowed) external onlyOwner {
        rewardTokenAllowed[token] = allowed;
        emit RewardTokenAllowedSet(token, allowed);
    }

    function fundPrize(address token, uint256 amountPerDraw, uint32 drawCount)
        external
        payable
        returns (uint256 scheduleId)
    {
        if (amountPerDraw == 0 || drawCount == 0) revert BadFunding();
        if (!rewardTokenAllowed[token]) revert TokenNotAllowed();
        uint256 total = amountPerDraw * uint256(drawCount);

        if (token == NATIVE_TOKEN) {
            if (msg.value != total) revert BadFunding();
            (bool ok,) = address(claimManager).call{value: total}("");
            require(ok, "native fund failed");
        } else {
            if (msg.value != 0) revert BadFunding();
            uint256 beforeBal = IERC20DrawManagerV5(token).balanceOf(address(claimManager));
            require(IERC20DrawManagerV5(token).transferFrom(msg.sender, address(claimManager), total), "transferFrom");
            uint256 received = IERC20DrawManagerV5(token).balanceOf(address(claimManager)) - beforeBal;
            if (received != total) revert BadFunding();
        }

        scheduleId = ++nextRewardScheduleId;
        rewardSchedules[scheduleId] = RewardSchedule({
            funder: msg.sender,
            token: token,
            amountPerDraw: amountPerDraw,
            startDrawId: uint32(currentDrawId + 1),
            remainingDraws: drawCount,
            cancelled: false
        });
        emit PrizeFunded(scheduleId, msg.sender, token, amountPerDraw, uint32(currentDrawId + 1), drawCount);
    }

    function cancelPrizeFunding(uint256 scheduleId) external {
        RewardSchedule storage schedule = rewardSchedules[scheduleId];
        if (schedule.funder != msg.sender) revert NotFunder();
        if (schedule.cancelled || schedule.remainingDraws == 0) revert BadFunding();
        uint256 refund = schedule.amountPerDraw * uint256(schedule.remainingDraws);
        schedule.remainingDraws = 0;
        schedule.cancelled = true;
        claimManager.releaseUnreserved(schedule.token, schedule.funder, refund);
        emit PrizeFundingCancelled(scheduleId, msg.sender, refund);
    }

    function feeRecipientCount() external view returns (uint256) {
        return feeRecipients.length;
    }

    function feeRecipientAt(uint256 index) external view returns (address account, uint16 bps) {
        FeeRecipient memory recipient = feeRecipients[index];
        return (recipient.account, recipient.bps);
    }

    function drawRewardLegCount(uint256 drawId) external view returns (uint256) {
        return drawRewardLegs[drawId].length;
    }

    function drawRewardLegAt(uint256 drawId, uint256 index) external view returns (address token, uint256 amount) {
        RewardLeg memory leg = drawRewardLegs[drawId][index];
        return (leg.token, leg.amount);
    }

    function drawFeeRecipientCount(uint256 drawId) external view returns (uint256) {
        return drawFeeRecipients[drawId].length;
    }

    function drawFeeRecipientAt(uint256 drawId, uint256 index) external view returns (address account, uint16 bps) {
        FeeRecipient memory recipient = drawFeeRecipients[drawId][index];
        return (recipient.account, recipient.bps);
    }

    function previewStartDraw() external view returns (bool due, bool willSkip, uint256 requiredFee) {
        uint64 periodStart = nextPeriodStart;
        uint64 periodEnd = periodStart + drawPeriod;
        if (block.timestamp < periodEnd) return (false, false, 0);

        uint256 totalTwab = twabController.getTotalTwabBetween(address(vault), periodStart, periodEnd);
        uint256 availablePrize = vault.availableYield();
        if (totalTwab == 0 || availablePrize == 0 || availablePrize < minPrizeThreshold) {
            return (true, true, 0);
        }

        return (true, false, randomnessOracle.getFee());
    }

    function plannedClaimLeafCount(uint256 drawId) public view returns (uint256) {
        uint256 legs = 1 + drawRewardLegs[drawId].length;
        uint256 leavesPerLeg = 1 + (drawTotalFeeBps[drawId] == 0 ? 0 : drawFeeRecipients[drawId].length);
        return legs * leavesPerLeg;
    }

    function plannedClaimLeafAt(uint256 drawId, uint256 index, address winner)
        public
        view
        returns (ClaimManagerV5.ClaimLeaf memory)
    {
        if (winner == address(0)) revert ZeroAddress();
        uint256 leavesPerLeg = 1 + (drawTotalFeeBps[drawId] == 0 ? 0 : drawFeeRecipients[drawId].length);
        uint256 legIndex = index / leavesPerLeg;
        uint256 slot = index % leavesPerLeg;
        (address token, uint256 amount, uint256 feeAmount) = _plannedLeg(drawId, legIndex);
        bytes32 distributionId = claimManager.distributionIdFor(address(this), bytes32(drawId));

        if (slot == 0) {
            return ClaimManagerV5.ClaimLeaf({
                distributionId: distributionId,
                leafIndex: index,
                account: winner,
                token: token,
                amount: amount - _allocatedFeeAmount(drawId, feeAmount)
            });
        }

        FeeRecipient memory recipient = drawFeeRecipients[drawId][slot - 1];
        return ClaimManagerV5.ClaimLeaf({
            distributionId: distributionId,
            leafIndex: index,
            account: recipient.account,
            token: token,
            amount: _recipientFeeAmount(drawId, feeAmount, recipient.bps)
        });
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
        uint256 totalPrincipalTwab = twabController.getTotalPrincipalTwabBetween(address(vault), periodStart, periodEnd);
        uint256 sponsorTwab = twabController.getDelegateTwabBetween(
            address(vault), twabController.SPONSOR_DELEGATE(), periodStart, periodEnd
        );
        uint256 boosterTwab = twabController.getDelegateTwabBetween(
            address(vault), twabController.BOOSTER_DELEGATE(), periodStart, periodEnd
        );
        uint256 grossYield = vault.availableYield();
        uint256 sponsorYield = totalPrincipalTwab == 0 ? 0 : (grossYield * sponsorTwab) / totalPrincipalTwab;
        uint256 boosterYield = totalPrincipalTwab == 0 ? 0 : (grossYield * boosterTwab) / totalPrincipalTwab;
        uint256 feeExemptYield = sponsorYield + boosterYield;
        uint256 feeBaseAmount = feeBase == FeeBase.PARTICIPANT_YIELD_ONLY ? grossYield - feeExemptYield : grossYield;
        uint256 feeAmount = (feeBaseAmount * totalFeeBps) / 10_000;
        uint256 availablePrize = grossYield;

        if (totalTwab == 0) {
            _recordSkip(drawId, periodStart, periodEnd, totalTwab, availablePrize, "ZERO_TWAB");
            return drawId;
        }
        if (availablePrize < minPrizeThreshold || availablePrize == 0) {
            _recordSkip(drawId, periodStart, periodEnd, totalTwab, availablePrize, "ZERO_PRIZE");
            return drawId;
        }

        vault.escrowYield(address(claimManager), availablePrize);
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
        draw.grossYield = grossYield;
        draw.sponsorYield = sponsorYield;
        draw.feeAmount = feeAmount;
        draw.rewardLegCount = uint32(_consumeRewardSchedules(drawId));
        _snapshotFeeRecipients(drawId);
        draw.status = DrawStatus.AwaitingSeed;
        drawIdByRequestId[requestId] = drawId;
        seedRequestedAt[drawId] = uint64(block.timestamp);

        emit DrawStarted(drawId, periodStart, periodEnd, totalTwab, availablePrize, requestId);
        emit DrawEconomicsSnapshot(drawId, grossYield, sponsorYield, feeAmount, availablePrize);
    }

    function rerequestSeed(uint256 drawId) external payable {
        Draw storage draw = draws[drawId];
        if (draw.status != DrawStatus.AwaitingSeed) revert BadConfig();
        uint64 requestedAt = seedRequestedAt[drawId];
        uint64 retryAfter = requestedAt + seedRequestTimeout;
        if (block.timestamp < retryAfter) revert SeedRequestStillActive(retryAfter);

        uint64 oldRequestId = draw.randomnessRequestId;
        delete drawIdByRequestId[oldRequestId];

        uint128 fee = randomnessOracle.getFee();
        require(msg.value >= fee, "insufficient oracle fee");
        uint64 newRequestId = randomnessOracle.requestRandomness{value: fee}(abi.encode(bytes32(drawId)));

        draw.randomnessRequestId = newRequestId;
        drawIdByRequestId[newRequestId] = drawId;
        seedRequestedAt[drawId] = uint64(block.timestamp);
        emit SeedRerequested(drawId, oldRequestId, newRequestId);

        if (msg.value > fee) {
            (bool ok,) = msg.sender.call{value: msg.value - fee}("");
            require(ok, "refund failed");
        }
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
        _registerDistribution(drawId, draw);
        emit RootFinalized(drawId, draw.root, draw.winnerCount, draw.totalPayout);
    }

    function _consumeRewardSchedules(uint256 drawId) internal returns (uint256 count) {
        for (uint256 scheduleId = 1; scheduleId <= nextRewardScheduleId; scheduleId++) {
            RewardSchedule storage schedule = rewardSchedules[scheduleId];
            if (schedule.cancelled || schedule.remainingDraws == 0 || drawId < schedule.startDrawId) continue;
            drawRewardLegs[drawId].push(RewardLeg({token: schedule.token, amount: schedule.amountPerDraw}));
            schedule.remainingDraws -= 1;
            count++;
        }
    }

    function _registerDistribution(uint256 drawId, Draw storage draw) internal {
        ClaimManagerV5.TokenTotal[] memory totalsScratch =
            new ClaimManagerV5.TokenTotal[](1 + drawRewardLegs[drawId].length);
        uint256 tokenCount = _addTokenTotal(totalsScratch, 0, NATIVE_TOKEN, draw.totalPayout);
        for (uint256 i = 0; i < drawRewardLegs[drawId].length; i++) {
            RewardLeg memory leg = drawRewardLegs[drawId][i];
            tokenCount = _addTokenTotal(totalsScratch, tokenCount, leg.token, leg.amount);
        }

        ClaimManagerV5.TokenTotal[] memory totals = new ClaimManagerV5.TokenTotal[](tokenCount);
        for (uint256 i = 0; i < tokenCount; i++) {
            totals[i] = totalsScratch[i];
        }
        claimManager.registerDistribution(bytes32(drawId), draw.root, draw.winnerCount, totals, ALGORITHM_VERSION_HASH);
    }

    function _plannedLeg(uint256 drawId, uint256 legIndex)
        internal
        view
        returns (address token, uint256 amount, uint256 feeAmount)
    {
        Draw storage draw = draws[drawId];
        if (legIndex == 0) {
            return (NATIVE_TOKEN, draw.totalPayout, draw.feeAmount);
        }
        RewardLeg memory leg = drawRewardLegs[drawId][legIndex - 1];
        uint256 legFee = (leg.amount * drawTotalFeeBps[drawId]) / 10_000;
        return (leg.token, leg.amount, legFee);
    }

    function _recipientFeeAmount(uint256 drawId, uint256 feeAmount, uint16 recipientBps)
        internal
        view
        returns (uint256)
    {
        uint16 drawBps = drawTotalFeeBps[drawId];
        if (drawBps == 0) return 0;
        return (feeAmount * recipientBps) / drawBps;
    }

    function _allocatedFeeAmount(uint256 drawId, uint256 feeAmount) internal view returns (uint256 allocated) {
        uint16 drawBps = drawTotalFeeBps[drawId];
        if (drawBps == 0) return 0;
        for (uint256 i = 0; i < drawFeeRecipients[drawId].length; i++) {
            allocated += (feeAmount * drawFeeRecipients[drawId][i].bps) / drawBps;
        }
    }

    function _snapshotFeeRecipients(uint256 drawId) internal {
        drawTotalFeeBps[drawId] = totalFeeBps;
        for (uint256 i = 0; i < feeRecipients.length; i++) {
            drawFeeRecipients[drawId].push(feeRecipients[i]);
        }
    }

    function _addTokenTotal(ClaimManagerV5.TokenTotal[] memory totals, uint256 count, address token, uint256 amount)
        internal
        pure
        returns (uint256)
    {
        if (amount == 0) return count;
        for (uint256 i = 0; i < count; i++) {
            if (totals[i].token == token) {
                totals[i].amount += amount;
                return count;
            }
        }
        totals[count] = ClaimManagerV5.TokenTotal({token: token, amount: amount});
        return count + 1;
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
