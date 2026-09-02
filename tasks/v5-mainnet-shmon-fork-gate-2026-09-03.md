# V5 Mainnet Real-shMON Fork Gate Evidence (2026-09-03)

## Release candidate

- Commit: `ecc71cdf31cfd53bafb79414db241b05c93e8c02`
- Git tree: `662d475880442b8082be4c24224381727ba6c58c`
- Fork EVM version: Cancun (test harness only; production artifact target remains Paris)

## Command

```bash
MONAD_MAINNET_RPC_URL="<archive RPC>" \
forge test --match-path 'test/v5/PrizeVaultV5Fork.t.sol' --evm-version cancun
```

The archive RPC credential was supplied by the operator and is not recorded here.

## Result

- Test suites: 1
- Tests passed: 6
- Tests failed: 0
- Tests skipped: 0
- Process exit: 0

Passing coverage:

- Native prize auto-compound through `ClaimManagerV5` against real shMON.
- Direct shMON deposit and withdrawal against real shMON.
- Mixed-asset full lifecycle: draw, `claimMany`, and withdrawal.
- Live funded-EOA direct shMON deposit emulation.
- Native deposit and withdrawal with real ERC-4626 conversion rounding.
- Fork dependency and configuration diagnostics.

## Gate conclusion

The previously skipped real-shMON fork release gate is closed for the release candidate above.
This evidence does not replace the external auditor's final retest and explicit mainnet GO/NO-GO verdict.
