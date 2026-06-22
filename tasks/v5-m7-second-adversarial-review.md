# V5 M7 Second Adversarial Review

**Status:** Complete locally on 2026-06-22.

## Deliverables

- [x] Second adversarial internal review after M6.
- [x] Findings fixed or accepted with rationale.
- [x] Deposit-cap launch value proposed to operator.
- [x] Cap tests expanded across direct shMON, sponsor deposits, rollback, and cap-reduction withdrawals.
- [ ] Monad fork suite executed with `MONAD_MAINNET_RPC_URL`.

## Artifacts

- `security_audit/AUDIT_REPORT_V5_M7_2026-06-22.md`
- `test/v5/PrizeVaultV5.t.sol`

## Deposit-Cap Proposal

Propose `25,000 MON` total principal cap for V5 launch. Operator must explicitly approve or revise before M9 deployment.

Suggested raise path:

1. Launch: `25,000 MON`.
2. After 3 clean V5 draw cycles and keeper/watcher drills: `50,000 MON`.
3. After 8 clean cycles or an external/competitive audit pass: `100,000 MON+`.

## Remaining Launch Gate

The fork lifecycle test exists but was not run locally because `MONAD_MAINNET_RPC_URL` is not set. Do not claim fork coverage has passed until it is run.
