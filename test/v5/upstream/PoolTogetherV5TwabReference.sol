// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @notice Minimal PoolTogether V5 TWAB reference used only for EverDraw M1 differential tests.
/// @dev Vendored from GenerationSoftware/pt-v5-twab-controller commit
///      29926961b2ecfa89e0f61a6d874c71b6f8e29112. The production contract is not linked to this
///      file; it preserves the upstream shared ring-buffer/accounting paths for tests.
contract PoolTogetherV5TwabReference {
    uint16 public constant MAX_CARDINALITY = 17_520;
    uint32 public immutable PERIOD_LENGTH;
    uint32 public immutable PERIOD_OFFSET;

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

    mapping(address => mapping(address => Account)) internal userObservations;
    mapping(address => Account) internal totalSupplyObservations;

    error BalanceLTAmount(uint96 balance, uint96 amount);
    error DelegateBalanceLTAmount(uint96 delegateBalance, uint96 delegateAmount);
    error TimestampNotFinalized(uint256 timestamp, uint256 currentOverwritePeriodStartedAt);
    error InvalidTimeRange(uint256 start, uint256 end);
    error InsufficientHistory(uint32 requestedTimestamp, uint32 oldestTimestamp);

    constructor(uint32 periodLength, uint32 periodOffset) {
        PERIOD_LENGTH = periodLength;
        PERIOD_OFFSET = periodOffset;
    }

    function increaseBalances(address vault, address account, uint96 amount, uint96 delegateAmount) external {
        _increaseBalances(userObservations[vault][account], amount, delegateAmount);
    }

    function decreaseBalances(address vault, address account, uint96 amount, uint96 delegateAmount) external {
        _decreaseBalances(userObservations[vault][account], amount, delegateAmount);
    }

    function increaseTotalSupplyBalances(address vault, uint96 amount, uint96 delegateAmount) external {
        _increaseBalances(totalSupplyObservations[vault], amount, delegateAmount);
    }

    function decreaseTotalSupplyBalances(address vault, uint96 amount, uint96 delegateAmount) external {
        _decreaseBalances(totalSupplyObservations[vault], amount, delegateAmount);
    }

    function getAccountDetails(address vault, address account) external view returns (AccountDetails memory) {
        return userObservations[vault][account].details;
    }

    function getTotalSupplyDetails(address vault) external view returns (AccountDetails memory) {
        return totalSupplyObservations[vault].details;
    }

    function getNewestObservation(address vault, address account) external view returns (uint16, Observation memory) {
        Account storage accountData = userObservations[vault][account];
        return _newestObservation(accountData.observations, accountData.details);
    }

    function getOldestObservation(address vault, address account) external view returns (uint16, Observation memory) {
        Account storage accountData = userObservations[vault][account];
        return _oldestObservation(accountData.observations, accountData.details);
    }

    function getNewestTotalSupplyObservation(address vault) external view returns (uint16, Observation memory) {
        Account storage accountData = totalSupplyObservations[vault];
        return _newestObservation(accountData.observations, accountData.details);
    }

    function getOldestTotalSupplyObservation(address vault) external view returns (uint16, Observation memory) {
        Account storage accountData = totalSupplyObservations[vault];
        return _oldestObservation(accountData.observations, accountData.details);
    }

    function getTwabBetween(address vault, address account, uint256 startTime, uint256 endTime)
        external
        view
        returns (uint256)
    {
        return _getTwabBetween(
            userObservations[vault][account], _periodEndOnOrAfter(startTime), _periodEndOnOrAfter(endTime)
        );
    }

    function getTotalSupplyTwabBetween(address vault, uint256 startTime, uint256 endTime)
        external
        view
        returns (uint256)
    {
        return _getTwabBetween(
            totalSupplyObservations[vault], _periodEndOnOrAfter(startTime), _periodEndOnOrAfter(endTime)
        );
    }

    function getBalanceAt(address vault, address account, uint256 time) external view returns (uint256) {
        return _getBalanceAt(userObservations[vault][account], _periodEndOnOrAfter(time));
    }

    function getTotalSupplyAt(address vault, uint256 time) external view returns (uint256) {
        return _getBalanceAt(totalSupplyObservations[vault], _periodEndOnOrAfter(time));
    }

    function _increaseBalances(Account storage accountData, uint96 amount, uint96 delegateAmount) internal {
        AccountDetails memory details = accountData.details;
        bool shouldRecord = delegateAmount != 0 && block.timestamp <= lastObservationAt();

        details.balance += amount;
        details.delegateBalance += delegateAmount;

        if (shouldRecord) {
            details = _recordObservation(accountData, details);
        }

        accountData.details = details;
    }

    function _decreaseBalances(Account storage accountData, uint96 amount, uint96 delegateAmount) internal {
        AccountDetails memory details = accountData.details;
        if (details.balance < amount) revert BalanceLTAmount(details.balance, amount);
        if (details.delegateBalance < delegateAmount) {
            revert DelegateBalanceLTAmount(details.delegateBalance, delegateAmount);
        }

        bool shouldRecord = delegateAmount != 0 && block.timestamp <= lastObservationAt();

        unchecked {
            details.balance -= amount;
            details.delegateBalance -= delegateAmount;
        }

        if (shouldRecord) {
            details = _recordObservation(accountData, details);
        }

        accountData.details = details;
    }

    function _recordObservation(Account storage accountData, AccountDetails memory details)
        internal
        returns (AccountDetails memory newDetails)
    {
        uint32 currentTime = uint32(block.timestamp - PERIOD_OFFSET);
        (uint16 newestIndex, Observation memory newestObservation) =
            _newestObservation(accountData.observations, details);

        uint256 currentPeriod = getTimestampPeriod(block.timestamp);
        uint256 newestPeriod = getTimestampPeriod(PERIOD_OFFSET + uint256(newestObservation.timestamp));
        uint16 writeIndex;

        if (details.cardinality == 0 || currentPeriod > newestPeriod) {
            writeIndex = details.nextObservationIndex;
            uint16 cardinality = _maxCardinality();
            details.nextObservationIndex = _nextIndex(writeIndex, cardinality);
            details.cardinality = details.cardinality < cardinality ? details.cardinality + 1 : cardinality;
        } else {
            writeIndex = newestIndex;
        }

        accountData.observations[writeIndex] = Observation({
            cumulativeBalance: _extrapolateFromBalance(newestObservation, currentTime),
            balance: details.delegateBalance,
            timestamp: currentTime
        });

        return details;
    }

    function _getTwabBetween(Account storage accountData, uint256 startTime, uint256 endTime)
        internal
        view
        returns (uint256)
    {
        if (endTime < startTime) revert InvalidTimeRange(startTime, endTime);
        _requireFinalized(endTime);
        if (isShutdownAt(endTime)) return 0;

        uint256 offsetStart = startTime - PERIOD_OFFSET;
        uint256 offsetEnd = endTime - PERIOD_OFFSET;

        Observation memory endObservation = _previousOrAt(accountData, uint32(offsetEnd));
        if (offsetStart == offsetEnd) return endObservation.balance;

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
        if (timestamp < PERIOD_OFFSET || isShutdownAt(timestamp)) return 0;
        return _previousOrAt(accountData, uint32(timestamp - PERIOD_OFFSET)).balance;
    }

    function _previousOrAt(Account storage accountData, uint32 offsetTargetTime)
        internal
        view
        returns (Observation memory)
    {
        AccountDetails memory details = accountData.details;
        if (details.cardinality == 0) return Observation({cumulativeBalance: 0, balance: 0, timestamp: 0});

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

    function _maxCardinality() internal pure virtual returns (uint16) {
        return MAX_CARDINALITY;
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
        unchecked {
            return uint128(
                uint256(observation.cumulativeBalance) + uint256(observation.balance)
                    * (offsetTimestamp - observation.timestamp)
            );
        }
    }

    function periodEndOnOrAfter(uint256 timestamp) external view returns (uint256) {
        return _periodEndOnOrAfter(timestamp);
    }

    function _periodEndOnOrAfter(uint256 timestamp) internal view returns (uint256) {
        if (timestamp < PERIOD_OFFSET) return PERIOD_OFFSET;
        if ((timestamp - PERIOD_OFFSET) % PERIOD_LENGTH == 0) return timestamp;
        return getPeriodEndTime(getTimestampPeriod(timestamp));
    }

    function currentOverwritePeriodStartedAt() public view returns (uint256) {
        return getPeriodStartTime(getTimestampPeriod(block.timestamp));
    }

    function hasFinalized(uint256 timestamp) public view returns (bool) {
        return timestamp <= currentOverwritePeriodStartedAt();
    }

    function getTimestampPeriod(uint256 timestamp) public view returns (uint256) {
        if (timestamp <= PERIOD_OFFSET) return 0;
        return (timestamp - PERIOD_OFFSET) / PERIOD_LENGTH;
    }

    function getPeriodStartTime(uint256 period) public view returns (uint256) {
        return period * PERIOD_LENGTH + PERIOD_OFFSET;
    }

    function getPeriodEndTime(uint256 period) public view returns (uint256) {
        return (period + 1) * PERIOD_LENGTH + PERIOD_OFFSET;
    }

    function lastObservationAt() public view returns (uint256) {
        return uint256(PERIOD_OFFSET) + (type(uint32).max / PERIOD_LENGTH) * PERIOD_LENGTH;
    }

    function isShutdownAt(uint256 timestamp) public view returns (bool) {
        return timestamp > lastObservationAt();
    }

    function _requireFinalized(uint256 timestamp) internal view {
        uint256 overwriteStart = currentOverwritePeriodStartedAt();
        if (timestamp > overwriteStart) revert TimestampNotFinalized(timestamp, overwriteStart);
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

contract SmallPoolTogetherV5TwabReference is PoolTogetherV5TwabReference {
    constructor(uint32 periodLength, uint32 periodOffset) PoolTogetherV5TwabReference(periodLength, periodOffset) {}

    function _maxCardinality() internal pure override returns (uint16) {
        return 8;
    }
}
