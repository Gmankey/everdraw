# V5 keeper unattended soak — runbook (closes the last V5-core gate)

**Date:** 2026-06-27. **Owner:** PM decides/verifies (read-only); operator runs key-bearing deploy + keeper. **Purpose:** prove the #161 keeper fix drives draws **unattended** — the one V5-core thing not yet live-verified (the first soak's keeper hung; draws were driven manually).

## PM decisions (made, not open)
1. **Merge #161 first** — it's verified against the keeper-reliability ticket. The keeper now uses `previewStartDraw` (a *new* contract view), so it can only be live-tested against a **redeployed** DrawManager that has it.
2. **Redeploy V5 testnet** off `staging` (post-#161), aligned params as before. This is the soak target.
3. **Primary gate = unattended resilience:** keeper drives **≥3 consecutive periods hands-off, zero hangs**, recovering from at least one forced bad-RPC. Skips alone satisfy this — it's the keeper-reliability proof.
4. **Secondary gate = one paying draw** (live-exercise `startDraw`→seed→`proposeRoot`→finalize→claim, which M8 never reached). Requires yield. The full cycle is forge-covered (DrawManagerV5.t.sol), so this is high-value-but-not-blocking.
5. **Sequencing:** this is the priority for V5-core readiness. Booster stays queued behind it. V4.1-A retirement runs in parallel whenever you do the pause/config (separate vaults, independent).

## Steps

### A. Merge #161 (you or builder click)
Then it's on `staging`.

### B. Redeploy V5 testnet (operator, key-bearing — same as last time)
From the soak worktree on latest `staging`:
```
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
read -s -p "deployer key (0xd5cc): " PRIVATE_KEY; export PRIVATE_KEY; echo
export GUARDIAN=0xd5cc1f1D7b78943bDF09541A2ace41B5c6D83431
export KEEPER=0x629Bd7f323fD29E3dF75855C9BC542889c6c1268
export TWAB_PERIOD_LENGTH_SEC=3600    # contract minimum is 1h
export DRAW_PERIOD_SEC=3600
export FIRST_PERIOD_DELAY_SEC=0
npx hardhat compile && npx hardhat run scripts/deploy-v5-testnet.js --network monadTestnet
```
Paste me the output. **I verify** alignment (`remainder 0`), `previewStartDraw` exists on the new DrawManager, and wiring.

### C. Yield for a paying draw (to confirm at execution)
The deployed shMON mock `0x282B`'s yield lever is opaque (repo source is a stub). **Decision:** at execution, either (a) confirm `0x282B`'s lever and bump assets-per-share, or (b) redeploy the soak against a `setRate`-capable mock (`test/mocks/MockERC4626YieldVault`) via the `SHMON` env override so we can mint yield on demand. I'll nail this when we get here; if it needs a deploy step, it's a small builder ask. **Skips don't need this — only the paying-draw gate does.**

### D. Run the keeper UNATTENDED (operator, key-bearing)
```
cd <soak worktree>; npm ci
export KEEPER_RPC_URL=https://testnet-rpc.monad.xyz KEEPER_LOOP=true
read -s -p "keeper key (0x629B): " PRIVATE_KEY; export PRIVATE_KEY; echo
node scripts/keeper-v5.js
```
Leave it running. **Do not** drive `startDraw` manually this time — the whole point is hands-off.

### E. Verification (me, read-only) — the gates
1. Keeper logs `previewStartDraw`-driven decisions and **advances ≥3 periods on its own** (skip or real), 0 hangs, 0 manual intervention.
2. Forced bad-RPC (kill/point at a dead endpoint briefly): keeper **retries then exits non-zero**, supervisor/restart resumes — no silent hang.
3. If yield injected: ≥1 draw goes `startDraw`→`Seeded`→`Proposed`→`Finalized` with a real `totalPayout` and a claimable winner — the full keeper path, live.
4. Every draw: stored `[periodStart,periodEnd)` correct, `totalTwab` matches the contract, no phantom.

When 1–2 hold (and ideally 3), the keeper-reliability ticket is **live-closed** and V5 core is operationally proven.

## Operator vs me
- **Operator (key-bearing):** merge #161; redeploy; (maybe) deploy yield mock + setRate; run keeper.
- **PM (me, read-only):** verify alignment/wiring/previewStartDraw; watch the unattended run; confirm each gate on-chain; pin the yield lever.
