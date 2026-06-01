# ADR-0029 — Randomness Oracle Abstraction (V4)

**Status:** Accepted as V4 spec.
**Date:** 2026-05-31
**Parent:** ADR-0024 (V4 contract spec)

## Context

V3 hardcodes the Pyth Entropy interface (`IEntropy`, `IEntropyConsumer`). If Pyth changes their callback signature, deprecates the contract, or we want to swap to Chainlink VRF / Drand / any other randomness source, V3 vaults need a full redeploy.

The 24h timelock on `entropy` address (from ADR-0021) covers *address swaps within the same interface*. It does NOT cover *interface changes* or *swap to a different protocol*.

V4 must abstract this so we never face a "redeploy because Pyth changed their SDK" event.

## Decision

### `IRandomnessOracle` interface

```solidity
interface IRandomnessOracle {
    /// @notice Request a random number. Returns a request id.
    ///         Implementation pays its own fee from msg.value or from elsewhere.
    function requestRandomness(bytes calldata userSeed) external payable returns (uint64 requestId);

    /// @notice View the fee an implementation will charge for a request.
    function getFee() external view returns (uint128);
}

interface IRandomnessOracleConsumer {
    /// @notice Called by the oracle when randomness is ready.
    ///         The oracle must enforce that only it can call this.
    function onRandomnessReceived(uint64 requestId, bytes32 randomNumber) external;
}
```

This interface is the thin contract that V4 vaults talk to. Concrete implementations:

- `PythRandomnessOracle` — wraps the existing Pyth `IEntropy` interaction
- `ChainlinkVRFOracle` — wraps Chainlink VRF (V2 or V2.5) when Chainlink is on Monad
- `DrandOracle` — wraps drand if we ever want timelock-based VRF

For V4 launch, only `PythRandomnessOracle` ships. The interface enables swap-via-timelock without redeploying the vault.

### V4 vault uses `IRandomnessOracle`

```solidity
IRandomnessOracle public randomnessOracle;
address public pendingOracle;
uint64 public pendingOracleEffectiveAt;
uint64 public constant ORACLE_CHANGE_DELAY = 24 hours;

function _commitDraw(uint256 rid) internal {
    // ...
    bytes32 userSeed = keccak256(abi.encode(
        rid, r.totalTickets, r.totalPrincipalAsset,
        block.prevrandao, block.timestamp
    ));
    uint128 fee = randomnessOracle.getFee();
    if (address(this).balance < fee) revert InsufficientVRFFee();

    r.state = RoundState.AwaitingVRF;
    r.vrfRequestTime = uint64(block.timestamp);
    r.requestId = randomnessOracle.requestRandomness{value: fee}(abi.encode(userSeed));
    requestToRound[r.requestId] = rid;
    emit RandomnessRequested(rid, r.requestId, fee);
}

function onRandomnessReceived(uint64 requestId, bytes32 randomNumber) external {
    require(msg.sender == address(randomnessOracle), "not oracle");
    uint256 rid = requestToRound[requestId];
    if (rid == 0) return;
    RoundData storage r = rounds[rid];
    if (r.state != RoundState.AwaitingVRF) return;
    r.randomNumber = randomNumber;
    r.state = RoundState.Drawn;
    emit RandomnessFulfilled(rid, requestId, randomNumber);
}
```

V4 vault is oracle-implementation-agnostic.

### Oracle swap via timelock

Same pattern as V3's entropy timelock (ADR-0021):

```solidity
function queueOracleChange(address newOracle) external onlyOwner {
    require(newOracle != address(0), "zero");
    pendingOracle = newOracle;
    pendingOracleEffectiveAt = uint64(block.timestamp) + ORACLE_CHANGE_DELAY;
    emit OracleChangeQueued(newOracle, pendingOracleEffectiveAt);
}

function commitOracleChange() external onlyOwner {
    require(pendingOracleEffectiveAt > 0, "no pending");
    require(block.timestamp >= pendingOracleEffectiveAt, "timelock");
    randomnessOracle = IRandomnessOracle(pendingOracle);
    pendingOracle = address(0);
    pendingOracleEffectiveAt = 0;
    emit OracleChanged(address(randomnessOracle));
}

function cancelOracleChange() external onlyOwner {
    pendingOracle = address(0);
    pendingOracleEffectiveAt = 0;
    emit OracleChangeCancelled();
}
```

The 24h timelock gives users a public exit window before any oracle swap. Same threat model as V3.

### `PythRandomnessOracle` implementation

Separate contract, deployed alongside V4 vaults. Wraps the existing Pyth Entropy SDK:

```solidity
contract PythRandomnessOracle is IRandomnessOracle, IEntropyConsumer {
    IEntropy public immutable entropy;
    address public immutable provider;
    address public immutable consumer; // V4 vault address

    constructor(address _entropy, address _provider, address _consumer) {
        entropy = IEntropy(_entropy);
        provider = _provider;
        consumer = _consumer;
    }

    function getFee() external view override returns (uint128) {
        return entropy.getFee(provider);
    }

    function requestRandomness(bytes calldata userSeed) external payable override returns (uint64) {
        require(msg.sender == consumer, "only consumer");
        bytes32 seed = bytes32(userSeed);
        return entropy.requestWithCallback{value: msg.value}(provider, seed);
    }

    function getEntropy() internal view override returns (address) { return address(entropy); }

    function entropyCallback(uint64 sequence, address _provider, bytes32 randomNumber) internal override {
        if (_provider != provider) revert WrongProvider();
        IRandomnessOracleConsumer(consumer).onRandomnessReceived(sequence, randomNumber);
    }
}
```

This is the bridge: V4 vault thinks it's calling `IRandomnessOracle`; the Pyth oracle adapter translates to/from Pyth's interface.

Deployment: one `PythRandomnessOracle` per V4 vault (each pinned to its specific consumer address). Or alternatively one shared oracle that maintains a consumer registry. **Decision: one per vault** — simpler ownership model, no cross-vault attack surface.

### Future: ChainlinkVRFOracle, DrandOracle

If/when needed, implement `IRandomnessOracle` for those providers. Operator calls `queueOracleChange(newOracleAddress)` on the V4 vault, waits 24h, calls `commitOracleChange()`. No vault redeploy needed.

## Consequences

- One more contract deploy (the `PythRandomnessOracle` adapter) per V4 vault. Trivial cost.
- One more code review surface for the audit: the adapter contract is small (~50 lines) and the audit must verify the `consumer == V4 vault` constraint holds.
- Future provider swap is a 24h operation, not a redeploy event.
- Indexer event signature changes: V3 emits `VRFRequested`/`VRFFulfilled` from the vault directly; V4 emits `RandomnessRequested`/`RandomnessFulfilled`. Indexer ABI must learn both shapes (V3 vs V4 vaults coexist during transition).

## Rejected alternatives

- **Inline the abstraction in the V4 vault.** Considered. Rejected because it grows the vault contract for no upside — the adapter is the right level to put the provider-specific code.
- **Use an existing standard interface (Chainlink VRF V2 interface as the abstraction).** Considered. Rejected because Chainlink VRF's `requestRandomness` signature includes Chainlink-specific concepts (subscriptions, key hashes) that don't map cleanly to Pyth. Cleaner to design our own minimal interface.
- **Make oracle address mutable without a timelock.** Rejected. Same threat model as ADR-0021's entropy timelock — 24h public window for users to exit is required.
