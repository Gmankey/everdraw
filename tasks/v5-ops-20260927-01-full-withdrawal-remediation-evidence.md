# OPS-20260927-01 full-withdrawal remediation evidence

**Status:** Candidate code complete; independent re-audit and governed live strategy migration required.

**Scope:** This record covers the shMON share-accounting defect reported in
`tasks/v5-live-operational-status-2026-09-27.md`. No live transaction, service
change, pause, deployment, queue, or commit was performed while preparing this
fix.

## Incident reproduction

Pinned Monad mainnet block: `108308126`.

- Vault: `0x97D9CA6DDD80869A32C951cc75b75D20e1300eDa`
- Strategy: `0xA3e037641825B17586cC9B5D4d9473A76f25c44b`
- shMON: `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`
- Participant: `0x69b3F8FA1759272EF770103E5B014A2379dC9EBc`
- Principal: `1001473042219858544`
- Strategy shares held: `616510436451682373`
- `previewWithdraw(principal)`: `621465110546683789`
- `convertToShares(principal)`: `615772575235795973`

The committed fork test calls the deployed vault at that block and expects the
exact live revert:

```text
InsufficientShares(
  required = 621465110546683789,
  held = 616510436451682373
)
```

Before the strategy correction, the candidate full-exit test also failed:

```text
InsufficientShares(620489574314359688, 614805974800695912)
```

This is preserved as a permanent two-part regression: the deployed contract
continues to prove the historical failure, while a locally deployed candidate
strategy must complete a true full exit against the same real shMON snapshot.

## Root cause

`ShmonStrategy.withdrawShares` used `previewWithdraw(assets)`. That method
quotes the shares needed for a separate shMON-to-MON unstake and includes the
venue's exit spread. EverDraw does not redeem to MON; ADR-0045 requires it to
transfer shMON shares. At the same time, `totalAssets()` used the gross
`convertToAssets(heldShares)` value. Mixing the net redemption quote with
gross share backing made a nominally solvent full exit request more shares than
the strategy held.

Direct shMON deposits had the reciprocal mismatch: they were credited with
`previewRedeem(shares)` while native deposits, strategy backing, emergency
exits, and available yield used gross share ownership. This could classify part
of a direct share deposit or compounded prize as yield.

## Corrected accounting policy

The canonical accounting basis is gross shMON share ownership:

- Share deposits credit `convertToAssets(shares)`.
- Share payouts use `convertToShares(assets)`, rounding down in favor of the
  pool.
- If a payout covers every gross asset still held by the strategy, all
  remaining shares are transferred. This prevents conversion dust from
  trapping a last account during a true shortfall/full-backing exit.
- `previewWithdraw` and `previewRedeem` are not used for EverDraw
  accounting. Their unstaking spread applies only if a recipient later elects
  to unstake shMON for MON.
- A payout below one shMON base unit may round to zero shares and still clear principal; that sub-share dust remains in the prize pot instead of trapping the account.
- Existing pro-rata shortfall accounting and permissionless emergency share
  exits remain unchanged.

ADR-0045 records this clarification and the external-dependency failure modes.

## Code changes

- `src/v5/strategies/ShmonStrategy.sol`
  - credits direct shares using `convertToAssets`;
  - transfers payouts using `convertToShares`;
  - transfers all held shares when paying all remaining gross assets.
- `test/mocks/MockERC4626YieldVault.sol`
  - exposes `convertToShares` independently of its configurable unstaking fee.
- Existing tests that asserted the faulty redemption-quote behavior now assert
  successful participant, sponsor, and Patron exits.
- The fee-share expectation uses the same gross conversion as yield escrow.
- Real-shMON tests credit compounded and direct-share deposits on the same gross
  basis.

## Regression coverage

Focused local suites:

```text
100 passed; 0 failed; 0 skipped
```

They cover:

- participant, sponsor, and Patron full exits with a nonzero unstaking spread;
- multi-user exit order without consuming the remaining account's backing;
- direct shMON deposit accounting without phantom yield;
- an explicit one-share rounding shortfall and last-user exit;
- a sub-share final principal balance that clears without taking prize yield;
- normal deposits, partial withdrawals, accrued yield, emergency exits,
  strategy migration, and draw fee/yield escrow behavior.

Pinned real-shMON fork commands:

```bash
MONAD_MAINNET_RPC_URL="<Monad mainnet RPC>" \
forge test --match-path 'test/v5/PrizeVaultV5FullExitFork.t.sol' \
  --evm-version cancun -vv

MONAD_MAINNET_RPC_URL="<Monad mainnet RPC>" \
MONAD_MAINNET_FORK_BLOCK=108308126 \
forge test --match-path 'test/v5/PrizeVaultV5Fork.t.sol' \
  --evm-version cancun -vv
```

Results: incident/migration suite 3 passed; full real-shMON lifecycle suite 6 passed; 0 failed, 0 skipped.

The focused incident suite proves:

1. the deployed strategy fails with the exact incident values;
2. the governed live-vault strategy migration succeeds and the candidate strategy succeeds while `previewWithdraw` still exceeds
   held shares;
3. full exit zeros principal and TWAB;
4. accrued prize yield remains in the vault; and
5. conversion rounding is at most two wei in the tested snapshot.

The full lifecycle fork suite includes native deposit, direct shMON deposit,
draw, yield escrow, root finalization, claim, automatic prize compound, and a
true full withdrawal that leaves the participant principal and TWAB at zero.

Final fork and full-suite command results are recorded in the PR checks and
review handoff.

## Independent re-audit checklist

The reviewer should independently confirm:

1. `convertToShares` is the correct gross ownership inverse for live shMON and
   does not include delayed unstaking fees.
2. A partial withdrawal cannot consume shares backing another participant,
   sponsor, Patron, or unescrowed principal.
3. Full exits preserve accrued prize yield when assets exceed principal.
4. Shortfall exits remain pro rata and the last account cannot be trapped by
   rounding.
5. Direct shMON deposits and `PrizeCompounded` credits do not create phantom
   available yield.
6. Draw yield escrow and fee leaves remain fixed share amounts and do not
   redeem to MON.
7. The replacement strategy runtime bytecode matches the reviewed artifact
   before any governance transaction is approved.

## Governed live remediation plan

This is a plan only. Every live action requires operator approval.

1. Decide whether to pause new deposits during the remediation window.
   Withdrawals and `emergencyRedeemShares` must remain available.
2. After independent approval, deploy only the reviewed `ShmonStrategy` with
   the live shMON address and call its one-time `setVault(liveVault)`.
3. Verify runtime bytecode, `shareToken()`, `vault()`, and the current vault
   state through two independent RPCs.
4. From the Ledger owner, call
   `queueStrategyChange(replacementStrategy)`; record the event and 24-hour
   effective time.
5. During the timelock, keep monitoring normal and emergency exits. Abort with
   `cancelStrategyChange()` if any address or bytecode check differs.
6. After the delay and a final preflight, call `commitStrategyChange()` from
   the Ledger owner. The vault atomically migrates all shMON shares and enforces
   the existing migration-tolerance check.
7. Verify the active strategy, old/new share balances, total assets, principal,
   available yield, and runtime bytecode. Simulate the incident wallet's full
   normal exit before asking that wallet to sign anything.
8. Only after explicit user approval, perform a real user-path full withdrawal
   and record the receipt as live closure evidence.

Until step 6 completes, the repository fix does not change the deployed
strategy. The existing permissionless `emergencyRedeemShares` path remains the
confirmed on-chain recovery route for the affected participant.
