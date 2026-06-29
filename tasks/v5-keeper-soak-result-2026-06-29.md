# V5 keeper unattended soak — result (2026-06-29)

**Verdict:** the V5 keeper drove the **full draw cycle live and unattended** for the first time. The last open V5-core gate (keeper hands-off + the complete paying cycle incl. live Pyth) is **met**. Two new keeper defects found → folded into `tasks/v5-keeper-reliability-builder-ticket.md` (Round 2).

## Deployment under test
Deployed from `staging` @ #161 (the keeper-fix worktree), aligned params (3600s):
- DrawManager `0x58502275bE5d5e998fE8318eC6343a0bc2A81C7c`
- PrizeVault `0x5dB2AA29ACf832baf43d10BAEd6ff53a23549f10`
- TwabController `0x165A546828e122935DE6B96ec894Ef14705194d7`
- Strategy `0xc6150fe2aA39e9b4f5BfE3148dc19f6F865B0B13`
- Keeper signer `0x629B…` (registered primaryProposer), guardian `0xd5cc…`.

## What was proven live (keeper unattended, zero manual draw steps)
- **`startDraw`** driven automatically by `previewStartDraw` (skip vs real, fee) — drew ≥12 periods on its own.
- **Empty-period skips:** draws 1, 2 → `ZERO_TWAB` skip, correct `[start,end)`, one-slot advance.
- **Paying draw + live Pyth:** draw 3 fired `startDraw` **with fee**, Pyth randomness requested (reqId 3155) and **seed delivered** → `Seeded`, payout 1.9985 MON snapshotted. **Live Pyth oracle integration verified** (request + callback) — never proven before.
- **Full cycle end-to-end:** draws 7 & 8 walked `startDraw → Seeded → Proposed → Finalized` and were **claimed by the keeper** (`finalizeRoot` + `claimMany` txs mined), unattended.
- Keeper signed everything with the correct registered wallet `0x629B` (after an initial wrong-wallet mixup, corrected).

## Verified-correct earlier (carried forward)
TWAB-1/2/3 (alignment, no phantom, skip+one-slot advance, transferable-share TWAB) — see `tasks/v5-twab-testnet-soak-result-2026-06-26.md` + 86 forge tests.

## Defects found (Round 2 — in the keeper ticket, builder-owned, not protocol bugs)
1. **Input-builder default log-concurrency (8) hangs on tenderly** → keeper silently stalled ~8.5h mid-`proposeRoot` until restarted with `WATCHER_LOG_CONCURRENCY=1`.
2. **Keeper reconciles only the last 5 draws** → draw 3's real 1.9985 MON prize, proposed late (after the hang), fell out of the window and is stranded at `Proposed`.

## Operating note for any production keeper run (until Round-2 fixes land)
- Set `WATCHER_LOG_CONCURRENCY=1` (sequential log scan) to avoid the tenderly hang.
- Don't let the keeper fall >5 draws behind, or proposed draws strand.

## Testnet-mock caveats (not product issues)
- The shMON testnet mock rounds a fresh deposit to ~99.96% backing, so `availableYield` needs a small top-up to clear; real shMON on mainnet does not.
- Draw 3's 2 MON was left unfinalized (operator: testnet, immaterial). The cycle itself is proven by draws 7/8.

## Status
V5 core is operationally proven on testnet. Remaining before a production keeper: the Round-2 keeper fixes (input-builder resilience + finalize-any-outstanding-draw). Booster door (ADR-0040) remains queued.
