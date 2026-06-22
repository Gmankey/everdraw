# V5 M8 Strategy Swap Runbook

**Status:** Draft for M8 execution.

## Purpose

Rehearse the V5 strategy-swap path on testnet so mainnet operators understand timing, user exit windows, alerts, and rollback options.

## Preconditions

- V5 testnet vault has small deposits.
- Current strategy and replacement strategy addresses are recorded.
- Swap delay/timelock value is recorded.
- Frontend/indexer can show vault status before and after the swap.

## Operator-Only Steps

1. Queue strategy swap to the replacement testnet strategy.
2. Record queue tx, eta, and emitted event.
3. During the exit window, verify withdrawals still work.
4. Execute strategy swap after the delay.
5. Verify assets/principal accounting is unchanged except expected testnet yield/dust.

## Builder-Safe Checks

- Confirm old/new strategy addresses.
- Confirm queue and execute events.
- Confirm withdraw after queue.
- Confirm deposit and withdraw after execute.
- Confirm frontend/indexer reflect the active strategy.

## Abort Conditions

- Withdrawals fail during the exit window.
- Principal accounting changes unexpectedly.
- Strategy address is wrong or unverified.
- Operator cannot explain rollback/emergency exit path before executing.
