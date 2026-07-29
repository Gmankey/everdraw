# Builder ticket — V5 fork-suite fixes, cancun EVM pin, mainnet keeper balance floor

**Raised:** 2026-07-29 (PM)
**Implements/relates to:** ADR-0045 (shMON-share-denominated payouts), ADR-0023 (shMON dependency model), ADR-0014/0015 (Pyth entropy + failover)
**Context:** Launch blocker #7 (real-mainnet-shMON fork test) is now *runnable* — see item 1. Three follow-ups fall out of it plus one mainnet-keeper config defect found during preflight.

---

## 1. Pin `evm_version = "cancun"` for the fork suite (root cause of blocker #7)

**Finding.** The real-mainnet-shMON fork suite was believed to be blocked on "no archive RPC." That was wrong. With an archive-capable RPC the suite still failed — every test reverted with `EvmError: NotActivated` on a plain `shMON.balanceOf` staticcall, ~1.02B gas consumed.

Root cause is an **EVM-version mismatch**, not RPC and not our contracts. The project compiles to `paris`; real mainnet shMON uses `PUSH0`, which only exists from Shanghai onward. Under a paris EVM the opcode is not activated, so the call reverts before any V5 logic runs.

Measured on `origin/staging` @ `08072a9`, forking Monad mainnet (chain 143, block ~91,214,245):

| `--evm-version` | Result |
|---|---|
| (default, paris) | 1 passed, **6 failed** — all `NotActivated` |
| `shanghai` | 1 passed, **6 failed** — still `NotActivated` |
| **`cancun`** | **5 passed**, 2 failed (see items 2 & 3) |

Under `cancun` these now pass against the **real** shMON contract:
- `test_fork_fullLifecycleMixedAssetsDrawClaimManyWithdrawAgainstRealShmon`
- `test_fork_directShmonDepositAndWithdrawAgainstRealShmon`
- `test_fork_claimManagerNativePrizeCompoundAgainstRealShmonBypassesMinDeposit`
- `test_fork_liveFundedEoaDirectShmonDepositStillEmulates`

**Required.**
- Pin the fork suite to `cancun` so this cannot silently regress — either a `[profile.fork]` in `foundry.toml` with `evm_version = "cancun"`, or an explicit `--evm-version cancun` in the documented fork-test command and any CI job that runs it.
- Confirm pinning `cancun` does not change deployed-bytecode expectations for the **mainnet deploy** path (the deploy currently targets `paris`; `scripts/deploy-v5-mainnet.js` verifies runtime bytecode against local artifacts). **Do not change the deploy EVM target as a side effect of this fix** — this is a test-harness pin only. State explicitly in the PR which target each path uses.
- Document the working command in the runbook, replacing the "requires archive RPC / cannot be run" note:
  ```
  MONAD_MAINNET_RPC_URL="<archive RPC>" forge test --match-path 'test/v5/PrizeVaultV5Fork.t.sol' --evm-version cancun
  ```

**Note on RPC:** an archive-capable endpoint *is* still required. The operator's existing free-tier Alchemy Monad Mainnet app serves ~1,000,000 blocks of historical state (verified: state reads succeed at head−1,000,000, fail at head−5,000,000), which is sufficient. No paid plan needed.

---

## 2. `test_fork_nativeDepositAndWithdrawAgainstRealShmon` — 0.012% shortfall vs real shMON

**Finding.** Under `cancun`:

```
[FAIL: assertion failed: 749908946740246056 != 750000000000000000]
test_fork_nativeDepositAndWithdrawAgainstRealShmon()
```

Withdrawing returns **749908946740246056** wei where the test expects exactly **750000000000000000** — short by 91,053,259,944 wei ≈ **0.0121%**.

**PM read (needs your confirmation, not assumed):** this is most likely real ERC-4626 rounding. `MockERC4626YieldVault` is 1:1 so exact-equality assertions hold; real shMON's `previewWithdraw`/`convertToShares` round in the vault's favour (standard anti-rounding-attack behaviour), so a small shortfall is expected and the **test assertion is too strict**.

**Required — do not just relax the assertion until the cause is confirmed.**
1. Determine whether the delta is purely share-conversion rounding, or whether any of it is value actually retained by our contracts (i.e. a leak).
2. If it is ERC-4626 rounding: change the assertion to an explicit tolerance (e.g. `assertApproxEqAbs` with a stated, justified bound) **and add a comment naming the rounding direction** so a future reader doesn't "fix" it back.
3. If any portion is retained by our code: that is a real defect under ADR-0045 — report before changing the test.
4. Either way, state in the PR whether a user withdrawing loses ~0.012% to rounding, since that is user-visible and must match what the docs/UI claim.

---

## 3. `test_fork_liveV4NativeBuyPathStillEmulates` — now fails `VaultIsStopped()`

**Finding.** This test exercises the live mainnet V4 pool `0x9263d84a141172d9618f4b08839f595EE03bC7E8`. The operator **stopped that pool on 2026-07-29** (`stoppedAt = 1785287207`) as part of V4 wind-down, and swept its 8.23 MON VRF reserve. All four mainnet V4 pools are now stopped. The test's precondition no longer exists.

**Required.** Update the test so it does not depend on a live, unstopped V4 pool — pin a historical fork block from before the stop, or retire the test if V4 emulation coverage no longer earns its keep now that V4 is fully wound down. Your call; state the reasoning in the PR.

---

## 4. Mainnet keeper balance floor is below a single draw's cost (config defect)

**Finding.** The mainnet deploy preflight reported the live Pyth entropy fee:

```
entropyFee: 770000000000000000   // 0.77 MON per draw request
```

But `scripts/keeper/fly.v5.mainnet.toml` sets:

```
KEEPER_LOW_BALANCE_WEI      = "500000000000000000"   // 0.5 MON  -> floor
KEEPER_LOW_BALANCE_WARN_WEI = "1000000000000000000"  // 1.0 MON  -> warn
```

**The floor (0.5 MON) is below the cost of one draw (0.77 MON + gas).** The keeper would report healthy at 0.6 MON while being unable to fund a single `startDraw`. The warn threshold (1.0 MON) gives roughly one draw of headroom, which is not enough lead time for a human to react to a weekly-cadence mainnet vault.

This is not theoretical — the UAT keeper crash-looped twice this week on exactly this class of failure, and the mainnet V4 keeper accumulated **17,937 consecutive failures** because it lacked gas to send a Skip tx.

**Required.**
- Raise `KEEPER_LOW_BALANCE_WEI` to **≈3 MON** (~4 draws of headroom) and `KEEPER_LOW_BALANCE_WARN_WEI` to **≈6 MON** (~8 draws), or propose better values derived from the live `entropyFee` plus observed gas.
- Better still: derive the floor from `entropyFee` at runtime (`floor = N * entropyFee + gas buffer`) so it self-corrects if Pyth's fee changes. Note ADR-0015 already treats entropy-provider behaviour as an external dependency that can change.
- Apply the same reasoning check to the UAT keeper (`everdraw-keeper-v5`), whose hourly cadence burns far faster.

---

## Acceptance

- [ ] Fork suite runs green (except any test intentionally retired) with the documented `cancun` command; command is in the runbook and CI.
- [ ] Mainnet deploy path's EVM target explicitly stated and **unchanged**.
- [ ] Item 2 root-caused, with a written statement of whether users lose ~0.012% to rounding.
- [ ] Item 3 test updated or retired with reasoning.
- [ ] Keeper floors raised (or derived), on both mainnet and UAT configs.
- [ ] PR cites ADR-0045 and this ticket.
