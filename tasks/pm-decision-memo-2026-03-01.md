# PM Decision Memo — Mainnet Path Update

**Date:** 2026-03-01  
**Source:** PM feedback + readiness review  
**Applies to:** `TicketPrizePoolShmonShMonad.sol`

## Finalized mainnet deploy parameters

- **Ticket price:** `0.1 MON`
- **Commit delay:** `10 blocks`
- **Round duration:** `604800` seconds (7 days)
- **ShMonad address:** **TBD** (to be provided before deploy)
- **Protocol fee:** `0%`

## Approved workstreams to mainnet

### 1) Contract hardening (first)
Required hardening before broad test migration:
- Pause controls
- Reentrancy guard
- Ticket overflow check
- Stuck-round recovery

### 2) Port tests to hardened contract
All meaningful coverage must target `TicketPrizePoolShmonShMonad.sol` (not legacy contracts).

### 3) Keeper automation bot
Build a reliable `executeNext()` keeper (cron/poller from funded wallet).

## Keeper reliability requirement (critical)

`executeNext()` must be called across lifecycle windows:

1. **After sales end:** commit (no strict deadline)
2. **After commit + 10 blocks:** draw (strict practical window)
   - Draw depends on `blockhash(targetBlock)`
   - Effective validity window is 256 blocks
   - On Monad this is only ~4–5 minutes
   - If missed, recommit path should recover, but repeated misses degrade UX
3. **After unstake ready:** settle (no strict deadline)

**Operational goal:** run keeper at high cadence (e.g., every 30 seconds), with alerting.

## Execution sequence (approved)

1. **Phase 1:** Harden contract
2. **Phase 2:** Port and pass tests on hardened contract
3. **Phase 3:** Build keeper bot + deploy script updates
4. **Testnet dry run** (end-to-end)
5. **Mainnet deploy**

## Clarification for task scoping

- Keep Phase 1 focused on hardening.
- Defer destructive repository cleanup (deleting legacy contracts/tests) until after test parity is confirmed in Phase 2.

## Go/No-Go gates

- **Gate A (post-Phase 1):** hardened contract compiles and baseline tests pass
- **Gate B (post-Phase 2):** migrated suites pass against hardened contract
- **Gate C (post-Phase 3):** keeper proves reliability under testnet timing constraints
- **Gate D:** ShMonad mainnet address confirmed and deployment checklist complete
