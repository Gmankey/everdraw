# ADR-0039 — V5 position is a real, transferable ERC-4626 share token

**Status:** Accepted (2026-06-25)
**Deciders:** Operator (PM)
**Revises:** ADR-0006 (Merkl-readable non-transferable position surface), and the V5 M1 decision to strip transferability/delegation from the TwabController.
**Relates to:** ADR-0036 (V5 TWAB architecture), ADR-0038 (plain-MON denomination — still holds; the share is denominated/displayed in MON terms).

## Context — a live, confirmed production problem
On mainnet (V4.1), MetaMask shows **"Malicious token — interacting with this token may result in a loss of funds"** on deposit. Root cause confirmed on-chain: the vault **advertises an ERC-20 interface** (name `EverDraw Position`, symbol `EVRDRAW-B`, `decimals`, `balanceOf`, `totalSupply`) — the ADR-0006 Merkl-readable surface — but has **no `transfer`/`approve`/`transferFrom`**. "A token you can hold but can never transfer or sell" is the **honeypot signature**, so MetaMask/Blockaid's token scanner flags it as malicious. (Rabby's scanner doesn't, which is why Rabby deposits cleanly.)

Two distinct heuristics are tripped by the current design:
1. **Honeypot token** — ERC-20 metadata with no transfer functions (the confirmed flag above).
2. **Drain simulation** — a deposit sends MON out and transfers **no token back** to the user's wallet (shMON is minted to the vault, the user gets internal ticket accounting), which reads as a one-way outflow.

V4.1 is immutable; the fix is for V5.

## Decision
**In V5, the prize-vault position is a real, standard, transferable ERC-20 / ERC-4626 share token** minted to the depositor on deposit and burned on withdrawal. This:
- removes the honeypot signature (a standard token *with* `transfer`/`approve` is not flagged),
- removes the drain heuristic (the user visibly **receives shares** on deposit),
- is the natural shape of the V5 TWAB architecture (PoolTogether lineage — prize vaults are transferable ERC-4626 shares with TWAB), and
- improves trust/UX: users hold a visible position token in their wallet.

This **reverses the M1 decision** to remove user-facing transfer/delegation from the TwabController, and **supersedes ADR-0006's non-transferable surface**: the share token *is* the Merkl-readable surface (real `balanceOf`/`totalSupply`/`Transfer` events), so no separate fake-ERC-20 is exposed.

## Why transferability is safe here
- **TWAB neutralizes odds-buying:** win odds use time-weighted balance, so acquiring shares right before a draw yields ~0 weight for that period. Transfer cannot be used to buy odds.
- **No-loss invariant unchanged:** shares represent principal; ADR-0036 §7.1 (no-loss, shortfall mode) still applies. Display stays MON-denominated (ADR-0038).
- **The TwabController already tracks balance changes on transfer** (PoolTogether design); M1 *added* work to disable it. Re-enabling standard transfer is less custom code, not more.

## Rejected alternative — separate Merkl adapter (keep vault non-token)
Move the ERC-20 metadata off the vault onto a read-only adapter Merkl points at, keeping positions non-transferable. Rejected as the primary path because it only patches the honeypot symptom, leaves the "deposit returns nothing visible" drain heuristic and poor UX intact, and keeps a non-standard design. (It is the lower-risk fallback if transferable positions are later deemed undesirable — see Consequences.)

## Consequences
### Contract (builder)
- `PrizeVaultV5` mints a standard transferable ERC-20 (ERC-4626 share) to the depositor on `deposit`/`depositShmon`; burns on withdraw. Implement full `transfer`/`approve`/`transferFrom`/`Transfer`/`Approval`.
- Wire share balance changes into the TwabController on mint/burn/**transfer** (re-enable the transfer hooks M1 removed). Sponsor delegate-to-zero accounting (ADR-0036 §3.1) is preserved.
- Merkl reads the real token (`balanceOf`/`totalSupply`/`Transfer`); retire the ADR-0006 fake-ERC-20 surface. Re-confirm the Merkl event-shape contract (ADR-0006 §event-semantics) against the real token.
- Keep MON-denominated display (ADR-0038): share amount may differ from MON value; surface MON value in UI.
### Security / audit
- New surface: transferable shares + TWAB-on-transfer + no-loss/shortfall interaction. Add to the M6/M7 audit scope. Tests: transfer mid-round updates TWAB correctly; transfer cannot increase current-period odds; withdraw/burn accounting; honeypot scanners no longer flag (post-deploy, verify a deposit no longer triggers the MetaMask "malicious token" warning — working rule #6).
### Product / regulatory
- Positions become tradeable (secondary market possible). They are no-loss savings positions (principal always withdrawable), not gambling entries — lower regulatory concern than the principal-at-risk idea (separate exploration). Flag for legal review before V5 launch.

## V4.1 interim (this ADR does not fix V4.1 — immutable)
Until V5: rely on Blockaid/MetaMask **token** allowlisting of `0x933FF608…F7DA` and `0x1886f329…404C` (false-positive report framed as a token, via FastLane/Monad fast-track), plus the in-app Smart Account note. See the builder backlog / runbook.

## Related
- ADR-0006 (superseded surface), ADR-0036 (TWAB architecture), ADR-0038 (MON denomination), `tasks/builder-backlog-2026-06-25.md`.
