# V5 M2 Local Gate Evidence — 2026-06-15

Branch/worktree: `feat/v5-twab-m1` at `/home/c/.openclaw/workspace/everdraw-v5-twab-m1`

## Scope Landed

- Added `src/v5/PrizeVaultV5.sol`.
- Added `src/v5/interfaces/IYieldStrategyV5.sol`.
- Added `src/v5/strategies/ShmonStrategy.sol`.
- Extended the ERC4626 mock with `redeem`, `previewWithdraw`, and configurable withdrawal spread support for V5 strategy testing.

## Covered M2 Requirements

- Native MON deposits through a strategy adapter.
- Direct shMON/share deposits valued into principal.
- Participant principal ledger and Merkl-shaped `Deposit`/`Withdraw` events.
- Sponsor principal ledger, sponsor events, and zero-odds TWAB accounting.
- Deposit cap and min-deposit controls.
- Withdrawals remain live while paused and after stop.
- Emergency share exits remain live while paused and after stop.
- Shortfall-mode pro-rata withdrawals under venue loss.
- Yield/donation does not increase ordinary principal withdrawals.
- Strategy swap timelock.
- Strategy swap migrates shMON shares and native rounding dust.
- shMON-style `previewWithdraw` spread is handled; withdrawals pay the requested principal amount exactly instead of overpaying rounded-up redeem output.
- Live shMON solvency is valued with gross `convertToAssets(shares)` while withdrawals still use `previewWithdraw(assets)`, avoiding false shortfall from the instant-exit spread.

## Tests Added

- `test/v5/PrizeVaultV5.t.sol`
- `test/v5/PrizeVaultV5Invariant.t.sol`
- `test/v5/PrizeVaultV5VenueInvariant.t.sol`
- `test/v5/PrizeVaultV5Fork.t.sol` (gated behind `MONAD_MAINNET_RPC_URL`)

## Verification

- `FOUNDRY_PROFILE=fork MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz MONAD_MAINNET_FORK_BLOCK=81669000 forge test --match-path 'test/v5/PrizeVaultV5Fork.t.sol' -vv`
  - 5 passed, 0 failed, 0 skipped.
  - Covers native MON deposit/withdraw against live shMON, direct shMON deposit/withdraw against live shMON, and live-funded-EOA shMON deposit emulation.
- `env -u MONAD_MAINNET_RPC_URL -u MONAD_MAINNET_FORK_BLOCK forge test --no-match-contract '.*Invariant.*' -vv`
  - 203 passed, 0 failed, 1 skipped.
- `forge test --match-path 'test/v5/PrizeVaultV5Invariant.t.sol' -vv`
  - 3 invariants passed, 0 failed, 0 skipped.
  - Full configured invariant depth: 5000 runs / 250000 calls per invariant.
- `forge test --match-path 'test/v5/PrizeVaultV5VenueInvariant.t.sol' -vv`
  - 2 invariants passed, 0 failed, 0 skipped.
  - Full configured invariant depth: 5000 runs / 250000 calls per invariant.
- `npm run build`
  - Hardhat compiled successfully.

## M2 Blocker Status

Resolved. See `tasks/v5-m2-fork-blocker-2026-06-15.md` for diagnosis. The fix is to run live shMON fork
tests with Cancun EVM semantics (`--evm-version cancun` or `FOUNDRY_PROFILE=fork`) and value shMON solvency
with `convertToAssets`, not instant-exit `previewRedeem`.
