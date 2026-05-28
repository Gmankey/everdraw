# PR 2 — Legacy Contract Cleanup

**Status:** Urgent, runs parallel to PR 1
**Target files:** `src/PrizeVault.sol`, `src/TicketPrizePool.sol`, `src/TicketPrizePoolShmon.sol` and their deploy scripts
**Source:** `security_audit/AUDIT_REPORT_2026-04-08_v1-era.md` findings C-02, C-04, H-01, M-01 through M-05
**Owner:** Builder → PM review before merge
**Target effort:** half a day

---

## Goal

Remove legacy code that carries critical security bugs but is NOT used in production. Fixing these contracts is not worth the effort — deletion closes 9 findings with one PR.

---

## Changes

### 1. Delete `PrizeVault.sol`

- Delete `src/PrizeVault.sol`
- Delete any Foundry script under `script/` that deploys `PrizeVault`
- Delete `test/PrizeVault.t.sol` if it exists
- Grep the whole repo for `PrizeVault` and remove every remaining reference
- **Closes:** C-02 (unchecked ERC-20), M-01 (fee-on-transfer), L-03 (CEI violation)

### 2. Delete `TicketPrizePool.sol` (v1)

- Delete `src/TicketPrizePool.sol`
- Delete the matching deploy script
- Delete `test/TicketPrizePool.t.sol` if it exists
- Grep for `TicketPrizePool` (standalone, not `TicketPrizePoolShmon*`) and clean up references
- **Closes:** H-01 (totalUnderlying inflation), L-02 (reentrancy), L-04 (CEI), M-03 (staker insolvency blocks finalization), M-04 (blockhash window), M-05 (overflow check)

### 3. Delete `TicketPrizePoolShmon.sol` (v2)

- Delete `src/TicketPrizePoolShmon.sol`
- Delete the matching deploy script
- Delete `test/TicketPrizePoolShmon.t.sol` if it exists
- Grep for `TicketPrizePoolShmon` and ensure only `TicketPrizePoolShmonShMonad` remains
- **Closes:** C-04 (no emergency escape), L-01 (reentrancy), M-02 (claimUnstake trust), M-04 (blockhash window), M-05 (overflow check)

### 4. Update README

Add a one-paragraph section near the top:

> **Supported contracts:** the only supported and deployed contract is `TicketPrizePoolShmonShMonad`. Earlier iterations (`TicketPrizePool`, `TicketPrizePoolShmon`, `PrizeVault`) have been removed from this repository as of PR 2 — they were not in production and carried security issues that were not worth fixing in place. See `security_audit/AUDIT_REPORT_2026-04-08_v1-era.md` for detail.

### 5. Update `remappings.txt` / `foundry.toml` if needed

If any of the deleted contracts are referenced in build config, remove those references. Run `forge build` at the end to confirm a clean build.

---

## Acceptance criteria

- `forge build` passes cleanly with no warnings about missing files
- `forge test` passes (only tests against `TicketPrizePoolShmonShMonad` should remain)
- `grep -rn "PrizeVault" src/ script/ test/` returns nothing
- `grep -rn "TicketPrizePool " src/ script/ test/` returns nothing (mind the trailing space — don't match `TicketPrizePoolShmonShMonad`)
- `grep -rn "TicketPrizePoolShmon[^S]" src/ script/ test/` returns nothing
- README mentions only `TicketPrizePoolShmonShMonad` as the supported contract
- Security audit report is retained in `security_audit/` as historical reference

---

## Why deletion and not fixing

| Contract | Why not fix |
|---|---|
| `PrizeVault` | Dead code with a critical ERC-20 bug. Nobody uses it. Rewriting would take longer than deleting, and any future ERC-20 vault should be a fresh design with SafeERC20 + balance-delta from day one. |
| `TicketPrizePool` v1 | Superseded by v3. Fixing H-01 alone requires a balance-delta refactor, and the contract still lacks owner/pause/emergency. Bringing it to parity with v3 means rewriting it, which is what v3 already is. |
| `TicketPrizePoolShmon` v2 | Same reasoning as v1. C-04 alone (no emergency escape) means any user funds deposited could be permanently locked. Zero production usage. Delete. |

---

## Out of scope

- Fixing any issues in `TicketPrizePoolShmonShMonad` — that's PR 1
- Writing a new ERC-20 vault — not on the roadmap
- Historical git rm preservation — git history keeps the deleted files accessible if ever needed
