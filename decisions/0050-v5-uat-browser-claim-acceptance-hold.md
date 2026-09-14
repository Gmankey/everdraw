# ADR-0050: Single-draw UAT browser-claim acceptance hold

Status: Accepted by the operator, 2026-09-15.
Related: ADR-0043, ADR-0045, ADR-0048. Scope: UAT keeper operations only.

## Context

The remaining release acceptance test requires a browser-originated claimMany. All 28 existing current-vault prizes checked on 2026-09-14 were already claimed; subsequent draws skipped with zero prize. Keeper claim receipts do not demonstrate browser usability. Auto-compound remains the default; there is no product opt-out or prize-only withdrawal change.

## Decision

V5_UAT_BROWSER_CLAIM_HOLD_MANAGER explicitly arms one draw on chain 10143 and must match the active DrawManager. After existing parity computation and on-chain claimed checks find an unpaid leaf, select the first such draw and atomically persist its manager, ClaimManager, draw ID and timestamp. Hold only keeper claimMany for that draw. Other draws and start/propose/finalize continue. Skipped and already-claimed draws cannot consume the hold.

The checkpoint uses the directory of V5_KEEPER_CLAIM_STATE_FILE (UAT: /data), so machine restart cannot select another draw. Disarming the environment variable restores normal keeper claiming without deleting history. An existing mismatched/corrupt checkpoint or write failure fails closed through existing keeper failure handling. No setting is committed to Fly env or mainnet config. Enabling this on any chain other than 10143 is rejected after both read/write networks are checked. No Solidity/compiler/dependency lockfile changes.

## Dependencies and failure behavior

- Monad testnet RPC: existing bounded retry and alert policy remains; reads must identify an actual unpaid leaf before selection.
- Fly persistent volume: checkpoint read/write failures are actionable keeper failures, not a silent broad claim pause.
- Independent root watcher and proof-publishing indexer: remain enabled; browser claim requires finalized, verified proofs. Missing proofs do not authorize bypassing verification.
- Browser wallet: operator supplies its own signature; builder never handles a key. Rejected/failed claims leave winnings escrowed; disarm restores automatic claiming.
- Healthchecks/Telegram: existing success/failure paths are unchanged; an intentional single-draw hold is not a keeper failure.

## Acceptance

Regression tests cover default-off mainnet behavior, chain/manager guards, exact one-draw persistence across restart, other-draw progress, disarm, corrupt/wrong-stack state and write failure. Live closure additionally requires saved browser-origin evidence, successful claimMany receipt, and PrizeCompounded/vault Deposit linkage. Until that transaction is observed, browser acceptance remains open.