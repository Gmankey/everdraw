# V5 M2 Fork-Test Diagnosis — 2026-06-15

## Diagnosis

The original blocker was not caused by a fork pinned before shMON activation. Re-running the fork at recent
Monad mainnet block `81669000` still reproduced `NotActivated` under the default Foundry profile:

- `MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz MONAD_MAINNET_FORK_BLOCK=81669000 forge test --match-path 'test/v5/PrizeVaultV5Fork.t.sol' --match-test test_fork_liveFundedEoaDirectShmonDepositStillEmulates -vvv`
  - `LIVE_LEDGER_OWNER -> shMON.deposit(1 ether, LIVE_LEDGER_OWNER)` reverted `NotActivated`.
- Public RPC `eth_call` for the same `from`, `to`, `value`, calldata, and block succeeded and returned shares:
  `635119152170354843`.

The fork context was otherwise correct:

- chain id: `143`
- fork block: `81669000`
- timestamp: `1781616751`
- shMON proxy code present: `793` bytes
- shMON implementation code present: `78600` bytes
- live Ledger owner balance present: `32601037001021143982` wei

Root cause: the default Foundry profile uses `evm_version = "paris"`, which cannot correctly emulate live
shMON deposit execution. Running the exact same pinned fork test with Cancun succeeds:

```bash
MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz \
MONAD_MAINNET_FORK_BLOCK=81669000 \
FOUNDRY_PROFILE=fork \
forge test --match-path 'test/v5/PrizeVaultV5Fork.t.sol' -vv
```

Result after the strategy valuation fix noted below: `5 passed, 0 failed, 0 skipped`.

The live RPC `callTracer` for successful `shMON.deposit(...)` shows the shMON proxy delegatecalling
implementation `0x856A4019228c265DEE336DF705277607c4A18e1B`. It does not expose a separate system/precompile
call, but the behavioral comparison is decisive: same block and same funded EOA succeeds via public RPC and
fails only under Foundry Paris. No fork-test deviation is needed.

## Follow-Up Fix

Once Cancun allowed the fork test to reach live shMON, it exposed an accounting issue: `previewRedeem` includes
the instant-exit spread, so valuing solvency with `previewRedeem(shares)` made a fresh native deposit look
insolvent immediately. `ShmonStrategy.totalAssets()` now uses gross shMON value via `convertToAssets(shares)`,
while withdrawals still use `previewWithdraw(assets)` so exact principal withdrawals redeem enough shares.
