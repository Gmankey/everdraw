# V5 launch-readiness checklist (external/infra dependencies)

**Date:** 2026-06-30. **Owner:** PM tracks; builder/ops execute. **Purpose:** answer "does everything still work with V5" — each external dependency, its status, and the action. Working rule #5/#6: every dep named, failure mode known, verified on the live surface before "done."

## 1. Merkl integration — NEEDS RE-CONFIRM (not a blocker yet)
- V5 changed the surfaces Merkl reads. **Participant points:** read from the real **transferable ERC-4626 share** (`balanceOf`/`totalSupply`/`Transfer`, ADR-0039) — not the retired V4.1 fake-ERC20. **Degen points:** read from the **distinct `BoostDeposit`/`BoostWithdraw` event stream** (ADR-0040), never as a token.
- **Action:** re-confirm Merkl indexes both correctly against the V5 testnet contracts **before mainnet** (the long-standing "Merkl event-shape re-confirm" item). Until confirmed, points attribution is unverified for V5.

## 2. MetaMask "malicious token" — STRUCTURALLY FIXED, allowlist at launch
- The honeypot signature (ERC-20 metadata + no transfer) is **gone in V5**: the participant share is a **real transferable** ERC-4626 (ADR-0039), and the Degen position is **events, not a token** (ADR-0040), so neither presents the honeypot pattern.
- **Residual:** a brand-new mainnet contract can still draw a *generic* Blockaid new-contract caution. **Action:** submit the V5 mainnet contracts for Blockaid/MetaMask allowlisting at launch (same process as V4.1), and Sourcify-verify them.

## 3. Indexer — NEEDS V5 RECONFIG (builder/ops)
- The live indexer is V4.1 (round-based, `POOL_ADDRESSES`). V5 is continuous (draws/claims/TWAB) with a different event model. The indexer must be **reconfigured/extended for V5** (draw lifecycle, winner/claim data, the Degen events) and pointed at V5 addresses via the canonical reconciliation control (backlog P0-1), not hand-set secrets.
- Ties to the keeper's input-builder (P1-3): mainnet winner-input building needs a real indexer/event archive, not RPC log scans.
- **Action:** builder ticket to bring the indexer to V5 before mainnet.

## 4. External providers — enumerate + verify each links (V5)
| Provider | Used by | V5 status / action |
|---|---|---|
| **RPC** (Alchemy / rpc.monad.xyz) | frontend reads, keeper, indexer | see §5 — capacity is the issue |
| **Pyth entropy** | DrawManager randomness | verified live on testnet (draw seeds delivered); confirm mainnet entropy + provider addresses at deploy |
| **shMON** | yield strategy | real shMON on mainnet (testnet mock has quirks); confirm address + ERC-4626 behavior at deploy |
| **Merkl** | points | §1 |
- **Action:** at mainnet deploy, verify each address in `deployments/monad-mainnet.json` and that each call path works on the live surface.

## 5. Alchemy monthly limit — YES, IT WILL GET WORSE (plan now)
- You've hit the free-tier monthly compute cap. With V5 the load **grows**: frontend reads (every visitor), keeper polling, and indexer scans all consume RPC. More users = more usage = the cap is hit sooner and harder. The free tier is **not viable for a public launch.**
- **Action (pick / combine):** (a) **upgrade to a paid Alchemy tier** sized for launch; (b) **reduce frontend RPC load** — lean on the existing `rpcCache.js`, batch/debounce reads, and cache draw/prize state; (c) **split load** — give the indexer/keeper their own RPC so frontend traffic doesn't compete. Minimum for launch: a paid RPC plan + read caching. This is a budget decision, not just config.

## Priority
Before V5 mainnet: §3 (indexer), §1 (Merkl re-confirm), §5 (paid RPC), §2 (allowlist) — in roughly that order. §4 is verified at deploy.
