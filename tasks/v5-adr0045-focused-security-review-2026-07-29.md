# V5 ADR-0045 focused security review - 2026-07-29

**Reviewer:** Codex, manual focused review. This is not an external audit.

**Reviewed base:** `origin/staging` at `08072a9`; ADR-0045 implementation commit `c7914e9`
(PR #231).

**Scope:** the ADR-0045 diff in `PrizeVaultV5`, `DrawManagerV5`, `ClaimManagerV5`,
`ShmonStrategy`, draw input/root generation, indexer draw derivation, and the V5 withdrawal
frontend. The review specifically checked that no synchronous shMON-to-MON redemption remains,
that a fixed share count is escrowed before root proposal, that claim accounting stays
share-denominated, and that failed auto-compounding cannot brick a claim.

## Result

No critical or high-severity issue was found in the fixed-share escrow, merkle, or claim flow.
One medium-severity accounting issue must be fixed before mainnet. One low-severity configuration
invariant should be enforced in the same pre-mainnet window.

## Findings

### M-1 - Native MON is counted as strategy backing but cannot be paid by share-only exits

**Files:**

- `src/v5/strategies/ShmonStrategy.sol:68-82`
- `src/v5/PrizeVaultV5.sol:346-362`
- `src/v5/PrizeVaultV5.sol:476-491`

ADR-0045 makes shMON shares the only payout asset. However, `ShmonStrategy.totalAssets()` still
adds `address(this).balance` to the MON-equivalent value of its shMON shares:

```solidity
return address(this).balance
    + shmonVault.convertToAssets(shmonVault.balanceOf(address(this)));
```

At the same time, `withdrawShares()` can transfer only shMON. When the requested asset value
requires more shares than the strategy holds, it silently clamps the transfer to all shares held:

```solidity
shares = shmonVault.previewWithdraw(assets);
if (shares > held) shares = held;
```

This creates two incompatible definitions of backing. Native MON can arrive through the payable
`receive()` function, a strategy migration, or a forced transfer. The vault then treats that MON
as liquid backing/yield even though neither a user withdrawal nor prize escrow can transfer it.

Concrete failure:

1. A user deposits 4 MON and the strategy holds shMON worth 4 MON.
2. The strategy receives 1 native MON.
3. `totalAssets()` reports 5 MON, so the vault reports solvent.
4. The next draw can treat the 1 MON as yield and move 1 MON-equivalent of shMON to ClaimManager.
5. The user then withdraws all 4 MON of principal. The remaining transfer is capped to the shares
   held, while the vault still debits the user's full principal. Native MON remains stranded and
   the user receives less share value than the position that was erased.

The same mismatch affects participant, sponsor, and Patron withdrawals. It can also cause native
balance to be classified as `availableYield()` and converted into a prize paid from shMON shares,
shifting backing away from principal.

**Severity rationale:** an unprivileged account can send native MON directly to the strategy and
create inconsistent solvency/yield accounting. This is primarily a griefing and fund-accounting
failure rather than a profitable theft path, but it violates the no-loss principal invariant and
can silently underpay an exit.

**Required fix:**

1. For the ADR-0045 `ShmonStrategy`, define `totalAssets()` solely from shMON shares. Raw native
   MON must not count as liquid backing unless it is first deposited into shMON.
2. Replace the silent `shares = held` clamp with an explicit insufficient-share revert. The vault
   transaction then reverts atomically instead of erasing full principal for a partial payout.
3. Add tests covering native MON sent to the strategy, full participant/sponsor/Patron exits, and
   prize escrow. Assert that native MON does not increase `availableYield()` and that an exit
   either transfers the full calculated share amount or reverts without changing principal.
4. Decide separately how accidental native MON is recovered or wrapped. That recovery mechanism
   must not make raw MON part of normal solvency accounting.

### L-1 - A strategy change can desynchronize the payout token

**Files:**

- `src/v5/PrizeVaultV5.sol:240-264`
- `src/v5/PrizeVaultV5.sol:144-146`
- `src/v5/DrawManagerV5.sol:231-234`

`PrizeVaultV5.payoutToken()` follows the current strategy dynamically, while `DrawManagerV5`
snapshots `payoutToken` as an immutable constructor value. `commitStrategyChange()` does not
require the replacement strategy to use the same share token.

If an owner queues and commits a strategy backed by a different share token, subsequent escrows
send the new token to ClaimManager but DrawManager builds and registers distributions for the old
token. Finalization then fails its escrow check and draw progression stalls.

The change is owner-only and delayed for 24 hours, so this is an operational/configuration hazard,
not an unprivileged exploit. For V5.0, enforce
`newStrategy.shareToken() == currentStrategy.shareToken()` at strategy commit. A share-token
migration should require a coordinated full-stack redeploy.

## Areas cleared

- **No synchronous redeem in V5 contracts.** No `strategy.withdraw()` or shMON `redeem()` call
  remains in `src/v5`. Principal, sponsor, Patron, emergency, and prize paths transfer shares.
- **Drift-free escrow.** `startDraw()` escrows first, stores the actual returned share count in
  `draw.totalPayout`, and requires the proposer to use exactly that amount.
- **Fee denomination.** Asset-denominated fee policy is converted proportionally into shares after
  escrow; fee and winner leaves sum within the fixed share budget.
- **Claim budget and fallback.** Claims set the bitmap and account against the registered token
  budget before external calls. Failed share compounding falls through to direct shMON payment,
  then deferred claim, while approvals are cleared after both success and caught failure.
- **Fresh auto-compound tranche.** `depositShmonFor` is restricted to the current ClaimManager,
  transfers the fixed shares into the strategy, and credits the strategy-reported asset value as
  fresh principal.
- **Root parity inputs.** JS and Python both use the on-chain `payoutToken` and explicit
  `totalPayout`; native-token inference was removed consistently.
- **Indexer display units.** User-facing MON-equivalent prize history comes from
  `DrawEconomicsSnapshot.grossYield`, while settlement and claims remain share-denominated.
- **V5 withdrawal frontend.** Both wallet and "convert to MON" choices call `withdrawShmon` or
  `boostWithdrawShmon`; the latter only adds the shmonad.xyz redirect and the 18-22 hour warning.
- **Legacy instant-redeem helper is not mounted.** `web/src/useShmon.js` still contains an
  `instantRedeem` helper used by `ShmonPanel`, but no `<ShmonPanel>` route is mounted in the current
  app. It is dead legacy code, not a live ADR-0045 path. It should not be reused without removal of
  the invalid instant-redemption assumption.

## Verification

- `forge test --match-path test/v5/V5ShmonSharePayoutLifecycle.t.sol -vv`: 2 passed.
- Source search confirmed no `strategy.withdraw(` or shMON `.redeem(` call under `src/v5`.
- Follow-up fork work corrected the original blocker diagnosis: `NotActivated` came from
  running Cancun-opcode mainnet shMON under the default Paris test EVM, not from RPC history.
- The real-shMON suite uses `FOUNDRY_PROFILE=fork` / `--evm-version cancun`; default Foundry
  and Hardhat deployment artifacts remain Paris.
- The native-deposit delta is ERC-4626 share-mint rounding in shMON's favour. No native MON or
  extra shares remain in PrizeVaultV5 or ShmonStrategy. The observed 1 MON deposit is credited
  about 0.91 bps lower; it is not a separate EverDraw withdrawal fee.
- The historical live-V4 buy test was retired after all V4 pools were intentionally stopped.
- An archive-capable RPC is still required, but the operator's existing free-tier Alchemy endpoint
  has sufficient recent-history depth.

## Launch disposition

ADR-0045's core share escrow and claim model is cleared. Mainnet remains blocked on M-1. L-1 should
be closed at the same time because strategy replacement is part of the documented recovery model.
The accepted post-beta external-audit posture is unchanged; this focused review does not replace it.

## 2026-08-12 addendum - timelocked draw-period governance

**Scope:** `DrawManagerV5.queueDrawPeriodChange`, `commitDrawPeriodChange`,
`cancelDrawPeriodChange`, and boundary activation in `startDraw`, implementing ADR-0036's cadence
tunable and ADR-0037's no-drift launch gate.

The new owner power cannot move principal, prizes, or escrow. Its operational risk is schedule
manipulation: a cadence change can alter future TWAB measurement windows, oracle spend, and draw
frequency. The 24-hour queue/commit delay provides an exit and monitoring window. A committed
change does not resize the currently scheduled period; it activates only after `startDraw`
consumes that exact interval. The replacement cadence must remain a multiple of the TWAB period.

Review disposition:

- no gap or overlap is introduced at activation because `nextPeriodStart` advances to the old
  period's exact end before the new duration is installed;
- mid-period commit behavior is deterministic and cannot alter accrued TWAB;
- zero-TWAB/zero-prize boundary periods still consume one complete old-cadence slot;
- queue, commit, and cancel are owner-only, and commit is delayed for 24 hours;
- another change cannot be queued while a committed cadence is awaiting boundary activation;
- queue, commit, activation, and cancellation are separately observable events.

Residual governance risk is accepted under ADR-0036's single-Ledger launch posture. The six-hour
UAT transition and seven-day final soak must complete before mainnet deployment.
