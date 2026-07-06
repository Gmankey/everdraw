# Builder ticket — Prize auto-compound (ADR-0043) — do THIRD / LAST before launch review

**Implements:** ADR-0043 (Accepted 2026-07-06). **Do not start until tickets 1 (checkpoint/history) and 2 (points-page reconciliation) are verified live on UAT.** This is the final pre-launch contract change and triggers the ADR-0042 scoped review + a full UAT re-soak.

## Decision summary (from ADR-0043 — read it first)
- **Default = auto-compound:** a winner's prize is automatically credited to their **vault principal** as a **new tranche at tenure 0** (§2b-consistent; a compounded win must not inherit an old tranche's multiplier).
- **Opt-out:** a wallet can opt out (on-chain registry) → its prizes pay to wallet as today.
- **Gas: keeper pays (socialized).** Do NOT deduct gas from prize amounts — merkle-leaf amounts stay clean.
- **Fallback is a feature, not an error:** if compounding cannot execute (vault paused, keeper down, opted-out, contract-wallet edge), the prize simply remains escrowed and claimable exactly as today.

## Contract changes (all three redeploy — claimManager is `immutable` in DrawManagerV5)
1. **PrizeVaultV5:** add `depositFor(address recipient)` payable — credits `recipient`'s principal (current `deposit()` credits `msg.sender` only). Emit the standard `Deposit(recipient, amount)` **plus** a marker event `PrizeCompounded(recipient, amount, distributionId)` so the indexer/UI can label it. `whenNotPaused nonReentrant` like `deposit()`.
2. **ClaimManagerV5:** add a compound path — for a winning leaf whose account has NOT opted out, pay via `vault.depositFor{value: amount}(account)` instead of `_tryPay(account, ...)`. Add `optOut(bool)` registry (mapping + event). If `depositFor` reverts (paused etc.), fall back to the existing deferred/escrow path — never brick a claim.
3. **DrawManagerV5:** redeploy unchanged (immutable `claimManager` forces it).
4. **Wiring:** `vault.setDrawManager(newDM)` — **timelocked** per ADR-0042; coordinate the delay with the operator. Enumerate the full re-point: keeper env, indexer `POOL_ADDRESSES` + re-backfill from the new deploy block, frontend `VITE_V5_*` addresses.

## Keeper
After finalize, execute compounds for all non-opted-out winners (batch with the existing claimMany machinery). Keeper gas is the accepted cost. Log per-winner outcomes; a failed compound is a WARN + escrow fallback, not a crash.

## Indexer
Ingest `PrizeCompounded` + the accompanying `Deposit` → opens a tranche at **tenure 0** for the winner (the standard Deposit ingestion should do this already — add a test proving a compounded prize starts a fresh tranche and does NOT extend an old one). Label the position event so history can show "prize restaked".

## Frontend
- Opt-out toggle (settings/profile), reading/writing the CM registry.
- Loud "You won N MON — automatically restaked" surfacing (banner + history row labeled as prize-compound). With auto-restake, winners must still KNOW they won.
- Claim UI retained for opted-out wallets and any legacy escrowed prizes.

## Tests / acceptance
- Unit: compound happy path; opted-out pays wallet; paused vault → deferred escrow; reentrancy (CM→Vault) blocked; tenure-0 tranche assertion; gas never deducted from leaf amount.
- UAT end-to-end: run a paying draw; verify the winner's principal grew by the prize, a fresh tranche exists at tenure 0, points derive on it at base multiplier, the UI shows the restake, and an opted-out wallet still receives MON.
- Then: ADR-0042 scoped review of the new CM⇄Vault path + full UAT re-soak before any mainnet plan.

## External dependencies (rule 5)
Pyth (unchanged), shMonad strategy (compound enters as native MON via existing path), keeper liveness (fallback = escrow), timelock delay on `setDrawManager` (operator-executed), indexer re-backfill after redeploy.
