# ADR-0042 — Degen-pool / large-deposit security hardening

**Status:** Proposed — operator asked what safeguards protect a large Degen-pool deposit before committing real capital.
**Date:** 2026-06-30
**Deciders:** User (operator) + Claude (PM)
**Context:** ADR-0040 (Degen pool), ADR-0036 (V5 architecture). No external audit (operator can't fund one). Operator is considering depositing a **large** sum into the Degen pool to bootstrap the prize, and needs the risk bounded.

## 1. Honest framing (no false promise)
**No contract is unhackable, and this one has no external audit.** We cannot promise "it can't be hacked." What we *can* do is **bound and mitigate** the risk so a large deposit isn't exposed to a single-point failure or an instant drain. This ADR records the safeguards; for serious capital, §4 (scoped audit / bug bounty + phased ramp) is the responsible path, not optional.

## 2. What already protects the capital (V5 today)
- **Withdrawal is always live / non-pausable** — `boostWithdraw` lets the depositor exit anytime; pause only blocks *new* deposits. This is the ultimate backstop against slow threats.
- **Strategy change is 24h-timelocked** (`STRATEGY_CHANGE_DELAY`) — the owner can't instantly swap the yield venue to drain.
- **Shortfall mode** — on venue loss, withdrawals settle pro-rata; principal ledger isn't inflated.
- **`nonReentrant`** on deposit/withdraw; **deposit cap** + **min deposit**; Sourcify-verified source; 90+ tests incl. invariants; internal audit (`security_audit/`).

## 3. The real holes — must close before a large deposit
1. **`setDrawManager` has NO timelock** (instant, owner-only). The draw manager can escrow/withdraw vault yield; a malicious one is the most direct drain path. **A compromised owner key could repoint it and drain in one tx.** → **Add a timelock** (mirror the 24h strategy-change pattern: queue → commit after delay) to `setDrawManager` and any other instant fund-affecting admin function. A timelock gives the operator a window to detect + **withdraw** before it takes effect.
2. **Owner is a single EOA** (testnet `0xd5cc`). A single key is the biggest live attack surface. → **Owner MUST be a multisig** (e.g. Gnosis Safe, 2-of-3+) on mainnet before any large deposit. Removes single-key-compromise → instant-control.
3. **No admin-change monitoring/alerting** → **add monitoring** that alerts on any queued strategy/draw-manager change, ownership transfer, pause/stop, or cap change — so the operator can react within the timelock window (ties to the protocol-monitor).

## 4. Operating policy for a large Degen deposit (operator-side)
- **Phased ramp** — do **not** drop the whole sum in one go. Ramp in tranches while monitoring; exposure stays bounded while confidence builds.
- **Cap** — set `depositCap` to bound total vault size to what you're willing to risk at each stage.
- **Scoped external audit or bug bounty before serious capital** — if a full audit isn't affordable, a *scoped* audit of just `PrizeVaultV5` + strategy + `DrawManagerV5`, or a bug bounty (e.g. Immunefi), materially cuts the residual smart-contract risk. For "a huge chunk," this is the honest minimum.
- **Secure the Degen wallet's own key** — withdrawal-always-live only protects you if you control that key.

## 5. Decision
Before a large mainnet Degen deposit: **(a)** timelock `setDrawManager` + audit the admin surface for other instant fund-affecting powers (builder); **(b)** owner = multisig (ops); **(c)** admin-change monitoring + alerts (builder/keeper); **(d)** phased ramp + cap + a scoped audit/bug-bounty (operator). Items (a)+(c) are a builder ticket citing this ADR; (b)+(d) are operator/ops actions.

## 6. Residual risk (stated plainly)
Even with all of the above, an undiscovered contract bug can still cause loss — that is the irreducible risk of unaudited (or even audited) DeFi. The safeguards reduce it from "single key / instant drain / unbounded" to "reviewed, verified, tested, timelocked, monitored, withdrawable, phased." Size the deposit accordingly.
