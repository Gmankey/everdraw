# Version Updates

Release notes for integrators building against the current EverDraw production contracts.

The deployment manifest remains the source of truth for active addresses, bytecode hashes, constructor args, and verification evidence:

→ [`deployments/monad-mainnet.json`](https://github.com/Gmankey/everdraw/blob/staging/deployments/monad-mainnet.json)

---

## V4.1 - Direct shMON deposits

**Status:** live for Vault A. Vault B remains V4.0 until its staggered V4.1 redeploy.  
**Contract:** `TicketPrizePoolV4`  
**Version constant:** `4.1.0`

### What changed

- Added `buyTicketsShmon(uint32 ticketCount)` for native-mode vaults, allowing users to buy tickets with shMON directly.
- Kept the existing MON path through `buyTickets(uint32 ticketCount)` unchanged.
- Added `getWithdrawableShares(uint256 rid, address user)` so frontends can read the exact shMON share amount `withdrawPrincipal` would return.
- Added `getRoundTicketPrice(uint256 rid)` so integrators can read the ticket-price snapshot for historical rounds without decoding internal storage or relying on off-chain assumptions.
- Regenerated `abi/TicketPrizePoolV4.json` with the new functions.
- Preserved existing `Deposit` and `TicketsBought` events, so indexers and Merkl-style integrations do not need a separate shMON event path.

### Integration notes

- Use `VERSION()` to distinguish V4.1 (`4.1.0`) from V4.0 (`4.0.0`) on a per-vault basis.
- Use `buyTickets` for MON deposits.
- Use `buyTicketsShmon` only on V4.1 native-mode vaults after the user has approved the vault to spend the required shMON shares.
- Do not assume every active V4-family vault has the V4.1 methods until the manifest marks that vault as V4.1.

### Related records

- [ADR-0035 - V4.1: native shMON direct deposit](https://github.com/Gmankey/everdraw/blob/staging/decisions/0035-v4-1-shmon-direct-deposit.md)
- [V4 launch record / V4.1 migration addendum](https://github.com/Gmankey/everdraw/blob/staging/decisions/0032-v4-launch-record.md)
- [V4 internal audit](https://github.com/Gmankey/everdraw/blob/staging/security_audit/AUDIT_REPORT_V4_2026-06-05.md)

---

## V4.0 - Current V4 architecture baseline

**Contract:** `TicketPrizePoolV4`  
**Version constant:** `4.0.0`

### What changed from V3

- Replaced single-winner-only accounting with configurable multi-winner allocation.
- Added sponsor-funded prize contributions with skipped-round refund handling.
- Added multi-recipient protocol-fee routing with per-round snapshots.
- Added a yield-vault transfer wrapper with retriable deferred claims if a payout transfer fails.
- Added a randomness-oracle abstraction, with Pyth Entropy used in production.
- Added a separate pauser role and one-way `stop()` retirement flow.
- Added a Merkl-readable non-transferable position surface: `name`, `symbol`, `decimals`, `balanceOf`, `totalSupply`, `Deposit`, and `Withdraw`.

### Integration notes

- V4 `getRoundInfo` does not include winner arrays. Read winners through `getRoundWinners`.
- Claims and withdrawals transfer shMON shares.
- Build new integrations against the V4 ABI and deployment manifest; V2/V3 addresses remain only for historical reads and in-flight claim settlement.
