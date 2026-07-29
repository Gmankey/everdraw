# V5 fork-suite and keeper-floor evidence - 2026-07-29

**Implements:** ADR-0045, ADR-0023, ADR-0014/0015 and
`tasks/v5-fork-suite-and-mainnet-keeper-floor-builder-ticket.md`.

## EVM targets

- Production Solidity / Hardhat deploy artifacts: **Paris**, unchanged.
- Default Foundry suite: **Paris**, unchanged.
- Real-mainnet-shMON fork harness only: **Cancun**, through `[profile.fork]` and the explicit
  `--evm-version cancun` command.

The split is intentional. Real mainnet shMON executes Cancun opcodes, while changing the deploy
target would invalidate the guarded runtime-bytecode comparison in `scripts/deploy-v5-mainnet.js`.

## Real shMON rounding

The failing exact-equality assertion was not an EverDraw withdrawal leak. A native 1 MON deposit
mints a whole-number shMON share amount rounded down by the ERC-4626 venue. PrizeVaultV5 credits
the strategy-reported redeemable value of those shares, so the position begins about 0.91 bps
below the raw MON input at the measured fork block.

The fork test now proves:

- credited principal equals real shMON `previewRedeem(strategyShares)`;
- the observed deposit conversion delta is bounded to 2 bps;
- PrizeVaultV5 and ShmonStrategy retain no native MON;
- the partial share withdrawal transfers the returned shares and subtracts exactly 0.25 MON from
  the already-rounded principal ledger.

Therefore a user does **not** lose another approximately 0.012% during EverDraw withdrawal. The
user-visible difference is the one-time MON-to-shMON share-mint rounding at deposit, retained by
the external shMON vault for its share holders.

## Retired V4 fork case

`test_fork_liveV4NativeBuyPathStillEmulates` was removed. All V4 pools are deliberately stopped,
the V4 keeper is destroyed, and the reserve was swept. Pinning an old block would preserve a test
for a retired product state rather than validate V5's current dependency boundary. The V5 fork
suite keeps the real shMON deposit, direct-share deposit, auto-compound and full lifecycle cases.

## Keeper floor

Both managed V5 keeper configs now set static minimums of:

- hard floor: 3 MON;
- warning: 6 MON.

At runtime the keeper also reads the live Pyth oracle fee every cycle and uses the greater of:

- configured floor vs `4 * oracleFee + 0.1 MON` gas buffer;
- configured warning vs `8 * oracleFee + 0.1 MON` gas buffer.

At the measured 0.77 MON fee, effective thresholds are 3.18 MON and 6.26 MON. If the fee read is
temporarily unavailable, the keeper logs a fallback and retains the static 3/6 MON protection so
finalization is not blocked solely by a threshold probe.

The same guard is configured for UAT. Deploying the updated UAT config requires the operator to
ensure the keeper signer is funded above the new effective warning threshold first.

## Commands

```bash
node --test scripts/keeper/balance-thresholds.test.mjs \
  scripts/keeper/keeper-v5.test.mjs \
  scripts/keeper/v5-runtime-alert-policy.test.mjs \
  scripts/keeper/v5-runtime-supervisor.test.mjs

forge test --match-path test/v5/PrizeVaultV5Fork.t.sol

FOUNDRY_PROFILE=fork \
MONAD_MAINNET_RPC_URL="<archive RPC>" \
forge test --match-path 'test/v5/PrizeVaultV5Fork.t.sol' --evm-version cancun
```
