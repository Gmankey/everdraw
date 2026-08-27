// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @title EverdrawTwabController
/// @notice V5 time-weighted balance accounting for registered EverDraw vaults.
/// @dev Adapted from PoolTogether V5 TWAB Controller at commit
///      29926961b2ecfa89e0f61a6d874c71b6f8e29112. See
///      `src/v5/twab/POOLTOGETHER_NOTICE.md` for provenance and license.
contract EverdrawTwabController {
    uint16 public constant MAX_CARDINALITY = 17_520;
    uint32 public constant MINIMUM_PERIOD_LENGTH = 1 hours;
    address public constant SPONSOR_DELEGATE = address(1);
    address public constant BOOSTER_DELEGATE = address(2);

    uint32 public immutable periodLength;
    uint32 public immutable periodOffset;
    address public owner;
    address public pendingOwner;

    struct Observation {
        uint128 cumulativeBalance;
        uint96 balance;
        uint32 timestamp;
    }

    struct AccountDetails {
        uint96 balance;
        uint96 delegateBalance;
        uint16 nextObservationIndex;
        uint16 cardinality;
    }

    struct Account {
        AccountDetails details;
        Observation[MAX_CARDINALITY] observations;
    }

    mapping(address => bool) public registeredVaults;
    mapping(address => mapping(address => Account)) internal accounts;
    mapping(address => Account) internal participantTotals;
    mapping(address => Account) internal principalTotals;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event VaultRegistered(address indexed vault);
    event BalanceIncreased(address indexed vault, address indexed account, uint96 amount, uint96 delegateAmount);
    event BalanceDecreased(address indexed vault, address indexed account, uint96 amount, uint96 delegateAmount);
    event TotalSupplyIncreased(address indexed vault, uint96 amount, uint96 delegateAmount);
    event TotalSupplyDecreased(address indexed vault, uint96 amount, uint96 delegateAmount);
    event ObservationRecorded(
        address indexed vault,
        address indexed account,
        uint96 balance,
        uint96 delegateBalance,
        bool isNew,
        Observation observation
    );
    event TotalSupplyObservationRecorded(
        address indexed vault,
        bool principal,
        uint96 balance,
        uint96 delegateBalance,
        bool isNew,
        Observation observation
    );

    error NotOwner();
    error NotPendingOwner();
    error NotRegisteredVault();
    error ZeroAddress();
    error PeriodLengthTooShort();
    error PeriodOffsetInFuture(uint32 offset);
    error BalanceTooLarge(uint256 balance);
    error BalanceLTAmount(uint96 balance, uint96 amount);
    error DelegateBalanceLTAmount(uint96 delegateBalance, uint96 amount);
    error TimestampNotFinalized(uint256 timestamp, uint256 currentOverwritePeriodStartedAt);
    error InvalidTimeRange(uint256 startTime, uint256 endTime);
    error InsufficientHistory(uint32 requestedTimestamp, uint32 oldestTimestamp);
    error CumulativeBalanceOverflow();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRegisteredVault() {
        if (!registeredVaults[msg.sender]) revert NotRegisteredVault();
        _;
    }

    constructor(uint32 _periodLength, uint32 _periodOffset) {
        if (_periodLength < MINIMUM_PERIOD_LENGTH) revert PeriodLengthTooShort();
        if (_periodOffset > block.timestamp) revert PeriodOffsetInFuture(_periodOffset);

        owner = msg.sender;
        periodLength = _periodLength;
        periodOffset = _periodOffset;

        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    function registerVault(address vault) external onlyOwner {
        if (vault == address(0)) revert ZeroAddress();
        registeredVaults[vault] = true;
        emit VaultRegistered(vault);
    }

    /// @notice Records an odds-bearing principal increase for `account`.
    function increaseBalance(address account, uint256 amount) external onlyRegisteredVault {
        uint96 castAmount = _toUint96(amount);
        _increaseAccount(msg.sender, account, castAmount, castAmount);
        _increaseParticipantTotal(msg.sender, castAmount);
        _increasePrincipalTotal(msg.sender, castAmount);
    }

    /// @notice Records an odds-bearing principal decrease for `account`.
    function decreaseBalance(address account, uint256 amount) external onlyRegisteredVault {
        uint96 castAmount = _toUint96(amount);
        _decreaseAccount(msg.sender, account, castAmount, castAmount);
        _decreaseParticipantTotal(msg.sender, castAmount);
        _decreasePrincipalTotal(msg.sender, castAmount);
    }

    /// @notice Records an odds-bearing principal transfer between two accounts.
    function transferBalance(address from, address to, uint256 amount) external onlyRegisteredVault {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (from == to || amount == 0) return;

        uint96 castAmount = _toUint96(amount);
        _decreaseAccount(msg.sender, from, castAmount, castAmount);
        _increaseAccount(msg.sender, to, castAmount, castAmount);
    }

    /// @notice Records principal whose yield sponsors prizes but has zero win odds.
    function increaseSponsorBalance(address sponsor, uint256 amount) external onlyRegisteredVault {
        uint96 castAmount = _toUint96(amount);
        _increaseAccount(msg.sender, sponsor, castAmount, 0);
        _increaseAccount(msg.sender, SPONSOR_DELEGATE, 0, castAmount);
        _increasePrincipalTotal(msg.sender, castAmount);
    }

    /// @notice Decreases sponsor principal and its sponsor-delegate TWAB.
    function decreaseSponsorBalance(address sponsor, uint256 amount) external onlyRegisteredVault {
        uint96 castAmount = _toUint96(amount);
        _decreaseAccount(msg.sender, sponsor, castAmount, 0);
        _decreaseAccount(msg.sender, SPONSOR_DELEGATE, 0, castAmount);
        _decreasePrincipalTotal(msg.sender, castAmount);
    }

    /// @notice Records booster principal whose yield sponsors prizes but has zero win odds.
    function increaseBoosterBalance(address booster, uint256 amount) external onlyRegisteredVault {
        uint96 castAmount = _toUint96(amount);
        _increaseAccount(msg.sender, booster, castAmount, 0);
        _increaseAccount(msg.sender, BOOSTER_DELEGATE, 0, castAmount);
        _increasePrincipalTotal(msg.sender, castAmount);
    }

    /// @notice Decreases booster principal and its booster-delegate TWAB.
    function decreaseBoosterBalance(address booster, uint256 amount) external onlyRegisteredVault {
        uint96 castAmount = _toUint96(amount);
        _decreaseAccount(msg.sender, booster, castAmount, 0);
        _decreaseAccount(msg.sender, BOOSTER_DELEGATE, 0, castAmount);
        _decreasePrincipalTotal(msg.sender, castAmount);
    }

    function balanceOf(address vault, address account) external view returns (uint256) {
        return accounts[vault][account].details.balance;
    }

    function delegateBalanceOf(address vault, address account) external view returns (uint256) {
        return accounts[vault][account].details.delegateBalance;
    }

    function totalPrincipalSupply(address vault) external view returns (uint256) {
        return principalTotals[vault].details.balance;
    }

    function totalParticipantSupply(address vault) external view returns (uint256) {
        return participantTotals[vault].details.delegateBalance;
    }

    function getAccountDetails(address vault, address account) external view returns (AccountDetails memory) {
        return accounts[vault][account].details;
    }

    function getTotalSupplyDetails(address vault) external view returns (AccountDetails memory) {
        return participantTotals[vault].details;
    }

    function getTotalPrincipalSupplyDetails(address vault) external view returns (AccountDetails memory) {
        return principalTotals[vault].details;
    }

    function getNewestObservation(address vault, address account) external view returns (uint16, Observation memory) {
        Account storage accountData = accounts[vault][account];
        return _newestObservation(accountData.observations, accountData.details);
    }

    function getOldestObservation(address vault, address account) external view returns (uint16, Observation memory) {
        Account storage accountData = accounts[vault][account];
        return _oldestObservation(accountData.observations, accountData.details);
    }

    function getNewestTotalSupplyObservation(address vault) external view returns (uint16, Observation memory) {
        Account storage accountData = participantTotals[vault];
        return _newestObservation(accountData.observations, accountData.details);
    }

    function getOldestTotalSupplyObservation(address vault) external view returns (uint16, Observation memory) {
        Account storage accountData = participantTotals[vault];
        return _oldestObservation(accountData.observations, accountData.details);
    }

    function getNewestTotalPrincipalSupplyObservation(address vault)
        external
        view
        returns (uint16, Observation memory)
    {
        Account storage accountData = principalTotals[vault];
        return _newestObservation(accountData.observations, accountData.details);
    }

    function getOldestTotalPrincipalSupplyObservation(address vault)
        external
        view
        returns (uint16, Observation memory)
    {
        Account storage accountData = principalTotals[vault];
        return _oldestObservation(accountData.observations, accountData.details);
    }

    /// @notice Account TWAB over `[startTime, endTime)`, using eligible delegated balance.
    function getTwabBetween(address vault, address account, uint256 startTime, uint256 endTime)
        external
        view
        returns (uint256)
    {
        return _getTwabBetween(accounts[vault][account], startTime, endTime);
    }

    /// @notice Participant-eligible total TWAB over `[startTime, endTime)`.
    function getTotalTwabBetween(address vault, uint256 startTime, uint256 endTime) external view returns (uint256) {
        return _getTwabBetween(participantTotals[vault], startTime, endTime);
    }

    /// @notice Full principal TWAB over `[startTime, endTime)`, including sponsor principal.
    function getTotalPrincipalTwabBetween(address vault, uint256 startTime, uint256 endTime)
        external
        view
        returns (uint256)
    {
        return _getTwabBetween(principalTotals[vault], startTime, endTime);
    }

    /// @notice Sponsor-delegated TWAB over `[startTime, endTime)`.
    function getDelegateTwabBetween(address vault, address delegate, uint256 startTime, uint256 endTime)
        external
        view
        returns (uint256)
    {
        return _getTwabBetween(accounts[vault][delegate], startTime, endTime);
    }

    function getBalanceAt(address vault, address account, uint256 time) external view returns (uint256) {
        Account storage accountData = accounts[vault][account];
        return _getBalanceAt(accountData, _periodEndOnOrAfter(time));
    }

    function periodEndOnOrAfter(uint256 timestamp) external view returns (uint256) {
        return _periodEndOnOrAfter(timestamp);
    }

    function currentOverwritePeriodStartedAt() public view returns (uint256) {
        return getPeriodStartTime(getTimestampPeriod(block.timestamp));
    }

    function hasFinalized(uint256 timestamp) public view returns (bool) {
        return timestamp <= currentOverwritePeriodStartedAt();
    }

    function getTimestampPeriod(uint256 timestamp) public view returns (uint256) {
        if (timestamp <= periodOffset) return 0;
        return (timestamp - periodOffset) / periodLength;
    }

    function getPeriodStartTime(uint256 period) public view returns (uint256) {
        return period * periodLength + periodOffset;
    }

    function getPeriodEndTime(uint256 period) public view returns (uint256) {
        return (period + 1) * periodLength + periodOffset;
    }

    function lastObservationAt() public view returns (uint256) {
        return uint256(periodOffset) + (type(uint32).max / periodLength) * periodLength;
    }

    function isShutdownAt(uint256 timestamp) public view returns (bool) {
        return timestamp > lastObservationAt();
    }

    function _maxCardinality() internal pure virtual returns (uint16) {
        return MAX_CARDINALITY;
    }

    function _increaseAccount(address vault, address account, uint96 amount, uint96 delegateAmount) internal {
        if (account == address(0)) revert ZeroAddress();
        Account storage accountData = accounts[vault][account];
        _increaseDetails(accountData, amount, delegateAmount);
        emit BalanceIncreased(vault, account, amount, delegateAmount);

        if (delegateAmount != 0) {
            (Observation memory observation, bool isNew) = _recordObservation(accountData);
            emit ObservationRecorded(
                vault, account, accountData.details.balance, accountData.details.delegateBalance, isNew, observation
            );
        }
    }

    function _decreaseAccount(address vault, address account, uint96 amount, uint96 delegateAmount) internal {
        Account storage accountData = accounts[vault][account];
        _decreaseDetails(accountData, amount, delegateAmount);
        emit BalanceDecreased(vault, account, amount, delegateAmount);

        if (delegateAmount != 0) {
            (Observation memory observation, bool isNew) = _recordObservation(accountData);
            emit ObservationRecorded(
                vault, account, accountData.details.balance, accountData.details.delegateBalance, isNew, observation
            );
        }
    }

    function _increaseParticipantTotal(address vault, uint96 amount) internal {
        _increaseTotal(participantTotals[vault], vault, amount, false);
    }

    function _decreaseParticipantTotal(address vault, uint96 amount) internal {
        _decreaseTotal(participantTotals[vault], vault, amount, false);
    }

    function _increasePrincipalTotal(address vault, uint96 amount) internal {
        _increaseTotal(principalTotals[vault], vault, amount, true);
    }

    function _decreasePrincipalTotal(address vault, uint96 amount) internal {
        _decreaseTotal(principalTotals[vault], vault, amount, true);
    }

    function _increaseTotal(Account storage accountData, address vault, uint96 amount, bool principal) internal {
        _increaseDetails(accountData, amount, amount);
        emit TotalSupplyIncreased(vault, amount, amount);

        (Observation memory observation, bool isNew) = _recordObservation(accountData);
        emit TotalSupplyObservationRecorded(
            vault, principal, accountData.details.balance, accountData.details.delegateBalance, isNew, observation
        );
    }

    function _decreaseTotal(Account storage accountData, address vault, uint96 amount, bool principal) internal {
        _decreaseDetails(accountData, amount, amount);
        emit TotalSupplyDecreased(vault, amount, amount);

        (Observation memory observation, bool isNew) = _recordObservation(accountData);
        emit TotalSupplyObservationRecorded(
            vault, principal, accountData.details.balance, accountData.details.delegateBalance, isNew, observation
        );
    }

    function _increaseDetails(Account storage accountData, uint96 amount, uint96 delegateAmount) internal {
        accountData.details.balance += amount;
        accountData.details.delegateBalance += delegateAmount;
    }

    function _decreaseDetails(Account storage accountData, uint96 amount, uint96 delegateAmount) internal {
        AccountDetails memory details = accountData.details;
        if (details.balance < amount) revert BalanceLTAmount(details.balance, amount);
        if (details.delegateBalance < delegateAmount) {
            revert DelegateBalanceLTAmount(details.delegateBalance, delegateAmount);
        }
        unchecked {
            accountData.details.balance = details.balance - amount;
            accountData.details.delegateBalance = details.delegateBalance - delegateAmount;
        }
    }

    function _recordObservation(Account storage accountData)
        internal
        returns (Observation memory observation, bool isNew)
    {
        if (block.timestamp > lastObservationAt()) {
            return (observation, false);
        }

        AccountDetails memory details = accountData.details;
        uint32 currentTime = uint32(block.timestamp - periodOffset);
        (uint16 newestIndex, Observation memory newestObservation) =
            _newestObservation(accountData.observations, details);
        uint256 currentPeriod = getTimestampPeriod(block.timestamp);
        uint256 newestPeriod = getTimestampPeriod(periodOffset + uint256(newestObservation.timestamp));
        uint16 writeIndex;

        if (details.cardinality == 0 || currentPeriod > newestPeriod) {
            writeIndex = details.nextObservationIndex;
            isNew = true;
            uint16 cardinality = _maxCardinality();
            accountData.details.nextObservationIndex = _nextIndex(writeIndex, cardinality);
            accountData.details.cardinality = details.cardinality < cardinality ? details.cardinality + 1 : cardinality;
        } else {
            writeIndex = newestIndex;
        }

        observation = Observation({
            cumulativeBalance: _extrapolateFromBalance(newestObservation, currentTime),
            balance: accountData.details.delegateBalance,
            timestamp: currentTime
        });
        accountData.observations[writeIndex] = observation;
    }

    function _getTwabBetween(Account storage accountData, uint256 startTime, uint256 endTime)
        internal
        view
        returns (uint256)
    {
        uint256 snappedStart = _periodEndOnOrAfter(startTime);
        uint256 snappedEnd = _periodEndOnOrAfter(endTime);

        if (snappedEnd < snappedStart) revert InvalidTimeRange(startTime, endTime);
        _requireFinalized(snappedEnd);
        if (isShutdownAt(snappedEnd)) return 0;

        uint256 offsetStart = snappedStart - periodOffset;
        uint256 offsetEnd = snappedEnd - periodOffset;

        Observation memory endObservation = _previousOrAt(accountData, uint32(offsetEnd));
        if (offsetStart == offsetEnd) {
            return endObservation.balance;
        }

        Observation memory startObservation = _previousOrAt(accountData, uint32(offsetStart));
        if (startObservation.timestamp != offsetStart) {
            startObservation = _temporaryObservation(startObservation, uint32(offsetStart));
        }
        if (endObservation.timestamp != offsetEnd) {
            endObservation = _temporaryObservation(endObservation, uint32(offsetEnd));
        }

        return (endObservation.cumulativeBalance - startObservation.cumulativeBalance) / (offsetEnd - offsetStart);
    }

    function _getBalanceAt(Account storage accountData, uint256 timestamp) internal view returns (uint256) {
        _requireFinalized(timestamp);
        if (timestamp < periodOffset || isShutdownAt(timestamp)) return 0;
        return _previousOrAt(accountData, uint32(timestamp - periodOffset)).balance;
    }

    function _previousOrAt(Account storage accountData, uint32 offsetTargetTime)
        internal
        view
        returns (Observation memory)
    {
        AccountDetails memory details = accountData.details;
        if (details.cardinality == 0) {
            return Observation({cumulativeBalance: 0, balance: 0, timestamp: 0});
        }

        (uint16 oldestIndex, Observation memory oldestObservation) =
            _oldestObservation(accountData.observations, details);
        if (offsetTargetTime < oldestObservation.timestamp) {
            if (details.cardinality < _maxCardinality()) {
                return Observation({cumulativeBalance: 0, balance: 0, timestamp: offsetTargetTime});
            }
            revert InsufficientHistory(offsetTargetTime, oldestObservation.timestamp);
        }

        if (details.cardinality == 1) return oldestObservation;

        (uint16 newestIndex, Observation memory newestObservation) =
            _newestObservation(accountData.observations, details);
        if (offsetTargetTime >= newestObservation.timestamp) return newestObservation;
        if (details.cardinality == 2) return oldestObservation;

        (Observation memory beforeOrAt,, Observation memory afterOrAt,) =
            _binarySearch(accountData.observations, newestIndex, oldestIndex, offsetTargetTime, details.cardinality);

        if (afterOrAt.timestamp == offsetTargetTime) return afterOrAt;
        return beforeOrAt;
    }

    function _binarySearch(
        Observation[MAX_CARDINALITY] storage observations,
        uint16 newestIndex,
        uint16 oldestIndex,
        uint32 target,
        uint16 cardinality
    )
        internal
        view
        returns (Observation memory beforeOrAt, uint16 beforeIndex, Observation memory afterOrAt, uint16 afterIndex)
    {
        uint256 left = oldestIndex;
        uint256 right = newestIndex < left ? left + cardinality - 1 : newestIndex;

        while (true) {
            uint256 current = (left + right) / 2;
            beforeIndex = _wrap(current, cardinality);
            beforeOrAt = observations[beforeIndex];
            afterIndex = _nextIndex(uint16(current), cardinality);
            afterOrAt = observations[afterIndex];

            bool targetAfterOrAt = beforeOrAt.timestamp <= target;
            if (targetAfterOrAt && target <= afterOrAt.timestamp) break;
            if (!targetAfterOrAt) {
                right = current - 1;
            } else {
                left = current + 1;
            }
        }
    }

    function _oldestObservation(Observation[MAX_CARDINALITY] storage observations, AccountDetails memory details)
        internal
        view
        returns (uint16 index, Observation memory observation)
    {
        if (details.cardinality < _maxCardinality()) {
            index = 0;
        } else {
            index = details.nextObservationIndex;
        }
        observation = observations[index];
    }

    function _newestObservation(Observation[MAX_CARDINALITY] storage observations, AccountDetails memory details)
        internal
        view
        returns (uint16 index, Observation memory observation)
    {
        index = _newestIndex(details.nextObservationIndex, _maxCardinality());
        observation = observations[index];
    }

    function _temporaryObservation(Observation memory observation, uint32 offsetTimestamp)
        internal
        pure
        returns (Observation memory)
    {
        return Observation({
            cumulativeBalance: _extrapolateFromBalance(observation, offsetTimestamp),
            balance: observation.balance,
            timestamp: offsetTimestamp
        });
    }

    function _extrapolateFromBalance(Observation memory observation, uint32 offsetTimestamp)
        internal
        pure
        returns (uint128)
    {
        uint256 cumulative = uint256(observation.cumulativeBalance) + uint256(observation.balance)
            * (offsetTimestamp - observation.timestamp);
        if (cumulative > type(uint128).max) revert CumulativeBalanceOverflow();
        return uint128(cumulative);
    }

    function _periodEndOnOrAfter(uint256 timestamp) internal view returns (uint256) {
        if (timestamp < periodOffset) return periodOffset;
        if ((timestamp - periodOffset) % periodLength == 0) return timestamp;
        return getPeriodEndTime(getTimestampPeriod(timestamp));
    }

    function _requireFinalized(uint256 timestamp) internal view {
        uint256 overwriteStart = currentOverwritePeriodStartedAt();
        if (timestamp > overwriteStart) revert TimestampNotFinalized(timestamp, overwriteStart);
    }

    function _toUint96(uint256 value) internal pure returns (uint96) {
        if (value > type(uint96).max) revert BalanceTooLarge(value);
        return uint96(value);
    }

    function _wrap(uint256 index, uint16 cardinality) internal pure returns (uint16) {
        return uint16(index % cardinality);
    }

    function _nextIndex(uint16 index, uint16 cardinality) internal pure returns (uint16) {
        unchecked {
            return uint16((uint256(index) + 1) % cardinality);
        }
    }

    function _newestIndex(uint16 nextIndex, uint16 cardinality) internal pure returns (uint16) {
        unchecked {
            return uint16((uint256(nextIndex) + cardinality - 1) % cardinality);
        }
    }
}
