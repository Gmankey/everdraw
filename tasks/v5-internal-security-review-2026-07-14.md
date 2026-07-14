# V5 internal security review — 2026-07-14

**Reviewer:** Claude (PM), manual review. **Not** an external audit (that is deferred to post-beta per ADR/checklist #213).
**Scope reviewed at:** `origin/staging` @ `1bfd0d1` (#217 — the current V5 head, post the auto-compound fix #216 and both timelocks #207/#212).
**Surface:** the V5 Solidity contracts + the specific ADR-grounded launch concerns (Merkl, MetaMask/Blockaid, TWAB-transfer odds, booster zero-odds, compound path, timelocks). **Out of scope of this pass:** the JS/TS surface (indexer, keeper, redeploy scripts, `web/`) — see "Follow-up" for how to cover it.

**Method:** full read of `PrizeVaultV5.sol`, `ClaimManagerV5.sol`, `EverdrawTwabController.sol`; targeted read of `DrawManagerV5.sol` / `ShmonStrategy.sol`; checked each finding against the relevant ADR (0036/0039/0040/0042/0043).

---

## Findings

### H-1 (HIGH — confirm intent): `emergencyRedeemShares` pays asset-proportional value (principal **+ prize yield**), and is ungated

**File:** `src/v5/PrizeVaultV5.sol:394-406` (`emergencyRedeemShares`; same shape in `emergencyRedeemSponsorShares:408-420`).

```solidity
uint256 sharesBalance = _strategyShares();          // ALL vault shares (back principal + accrued yield)
uint256 principalBefore = totalPrincipal;
shares = (sharesBalance * principalAmount) / principalBefore;
_debitParticipant(msg.sender, principalAmount);
require(strategy.transferShares(msg.sender, shares), "share transfer failed");
```

**The issue.** Every *other* exit pays **par** (principal only), because `_payoutAmount(P)` returns `P` when solvent:
- `withdraw` / `withdrawShmon` → user receives assets/shares worth exactly `principalAmount`.

`emergencyRedeemShares` instead transfers `totalShares * P / totalPrincipal` shares, which are worth
`totalAssets * P / totalPrincipal = P + yield * (P / totalPrincipal)`.

Since `availableYield() = strategy.totalAssets() - totalPrincipal` is exactly the pool of yield that funds prizes (it is what `escrowYield` later pulls to the ClaimManager at draw time), this function lets **any principal holder withdraw their principal *plus* a pro-rata slice of the undistributed prize yield.** It has **no gating** — not `whenNotPaused`, not `stoppedAt`, not `shortfallMode`, no owner flag — so it is callable in normal operation, not just in an emergency.

**Why it matters / exploit.** The core V5 invariant is *principal is no-loss and withdrawable; yield belongs to the prize pool*. This function breaks the second half: a depositor (especially a whale with a large `P/totalPrincipal`) can, between draws, call `emergencyRedeemShares` to skim their proportional share of accrued yield that would otherwise have been escrowed for the next draw — repeatedly, deposit-and-skim. It is a strictly better exit than `withdraw` whenever yield has accrued, so a rational participant always prefers it, continuously draining the prize pool. Principal (no-loss) is not directly stolen, but **prize value is**, defeating the mechanism.

**Confidence:** ~0.85 that the payout is yield-inclusive and ungated (verified against the par-paying `withdraw`/`withdrawShmon` paths). The ~0.15 is whether this is *intended* "break-glass, take your fair assets and leave" semantics — but even so, the absence of any gate makes it abusable in normal operation.

**Recommendation.** Either (a) gate `emergencyRedeemShares`/`emergencyRedeemSponsorShares` so they are only callable when the vault is `stopped`, `paused`, or in `shortfallMode` (true break-glass), **or** (b) cap the payout at par like every other exit — compute `shares` to be worth `_payoutAmount(principalAmount)` (i.e. principal, or the pro-rata amount in shortfall) rather than `totalShares * P / totalPrincipal`. Option (b) keeps a standing shares-exit without leaking yield; option (a) preserves proportional redemption but only in genuine emergencies. Add a test asserting a solvent-state emergency redeem returns principal-worth, not asset-worth.

---

## Areas reviewed and cleared

- **Auto-compound `depositFor` minDeposit bypass (#216)** — `_requireDepositAllowed(assets, !_isCurrentClaimManager(msg.sender))` (`PrizeVaultV5.sol:284,431`). The bypass is tightly scoped: `_isCurrentClaimManager` returns true only for `drawManager.claimManager()` (the exact ClaimManager wired to the current draw manager), via a `try/catch` that fails closed. It only relaxes the *anti-dust* `minDeposit` check — pause, stop, cap, and shortfall checks still apply. `drawManager` is owner-set + timelocked, so the trusted caller can't be spoofed by an outsider. **Cleared.**
- **Compound / claim path reentrancy (ADR-0043)** — `ClaimManagerV5._claim` sets the claimed bit and updates accounting *before* any external call, and `claim`/`claimMany`/`claimDeferred` are all `nonReentrant`. `_tryCompoundOrPay` → `vault.depositFor` (itself `nonReentrant`) or `_tryPay` native send: a malicious recipient/vault reentering hits the guard. The never-brick fallback (compound → wallet → deferred escrow) is correctly ordered. **Cleared.**
- **Merkle proof safety (ClaimManagerV5)** — leaves are domain-separated (`LEAF_DOMAIN`) and hashed with `abi.encode` (6 fields); internal nodes use sorted-pair `abi.encodePacked` of two `bytes32`. Leaves cannot be confused with internal nodes → no second-preimage / forged-leaf path. Distribution escrow is reserved and budget-checked. **Cleared.**
- **MetaMask/Blockaid honeypot (ADR-0039)** — `PrizeVaultV5` implements real `transfer`/`transferFrom`/`approve`/`allowance` + `Transfer`/`Approval` events, and `deposit` visibly credits the depositor (mints, emits `Transfer(0 → account)`), killing both the "hold-but-can't-transfer" honeypot signature and the "deposit returns nothing" drain heuristic. The structural fix is present in code. **Cleared in code** — but ADR-0039's own requirement stands: **post-deploy, verify on a live wallet that a deposit no longer triggers the MetaMask "malicious token" warning** (working-rule #6). Keep in the launch checklist.
- **TWAB access control + booster/sponsor zero-odds (ADR-0040)** — every balance mutator on `EverdrawTwabController` is `onlyRegisteredVault`. `increaseSponsorBalance`/`increaseBoosterBalance` credit the account's balance but route the *delegate* (odds-bearing) balance to the `SPONSOR_DELEGATE`/`BOOSTER_DELEGATE` sinks, so boosters/sponsors carry principal with **zero win odds** — the "not gambling" boundary holds in code. **Cleared.**
- **Transferable-share odds (ADR-0039)** — `transferBalance` moves delegate (odds) balance at the current timestamp; because odds are time-weighted (TWAB), shares acquired right before a draw contribute ~zero weight to that period. Buying odds via transfer is neutralized as designed. **Cleared.**
- **Timelocks (#207/#212, ADR-0042)** — `setDrawManager` and strategy/oracle changes are queue→wait(`STRATEGY_CHANGE_DELAY` = 24h)→commit, owner-gated, with commit checking `block.timestamp >= effectiveAt`. `setDrawManager` is now a compat alias that only queues. **Cleared.**

## Trust assumptions (documented design, not new vulnerabilities)

- **Keeper/proposer + guardian model (ADR-0015/0042).** `DrawManagerV5.proposeRoot` accepts the merkle root/winnerCount/totalPayout from the proposer; correctness is enforced off-chain (JS/Python parity) and on-chain only by the challenge/veto window + guardian veto. A malicious/compromised proposer that survives the window could finalize a wrong root. This is the accepted keeper trust boundary, not a code bug — but it is the single most important reason the eventual **external audit + the guardian-veto monitoring** matter before high-TVL.
- **Owner surface.** A compromised owner key can (timelocked) swap draw manager/strategy/oracle and (instantly) set pauser/cap/minDeposit, pause, and `stop`. Consistent with ADR-0022/0031's documented EOA-owner posture; multisig migration remains future work.

## External-dependency verification (launch-gating, verify at/after deploy — not code findings)

- **Merkl** — re-confirm Merkl indexes the real ERC-4626 `Transfer`/`balanceOf` surface (ADR-0039) **and** the distinct `BoostDeposit`/`BoostWithdraw` stream (ADR-0040), and never credits booster balance as odds-bearing participant points.
- **MetaMask/Blockaid** — post-deploy live-wallet check (above); submit V5 mainnet contracts for allowlisting + Sourcify verify.
- **Pyth entropy / shMON / RPC** — verify mainnet addresses resolve on the live surface; real shMON (not the testnet mock) exercised via the fork test.

## Follow-up

1. **H-1** → builder ticket (gate or cap `emergencyRedeem*`), with a regression test.
2. **JS/TS surface** (indexer / keeper / `web/` / redeploy scripts) was **not** covered here — run the `security-review` skill against a real `staging`-based diff for that surface (its injection/secrets/auth checklist fits JS/TS, not Solidity).
3. Full external audit stays deferred to post-beta (#213); this internal pass is the pre-beta bar, and H-1 should be resolved before beta regardless.
