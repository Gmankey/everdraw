# Security

## Audit status

EverDraw has not yet completed a formal third party audit. A comprehensive audit covering both the V2 vault contract and the upcoming Phase 2 architecture is budgeted and planned before scaling TVL.

This page will update with the audit report, scope, and findings when complete.

**Until then, do not deposit more than you are comfortable losing.**

---

## What has been validated

- 92 V2 unit and integration tests passing
- Full round lifecycle (deposit, commit, draw, settle, claim, withdraw) validated end to end on Monad mainnet across the V1 contract's production history (38 rounds settled), and on V2 from 2026-05-06
- Keeper preflight system in production for over 4 weeks
- shMON integration tested through production stake flows on V1 and V2
- Both vault contracts verified on Monad explorer with public source

---

## Contract properties

**Non custodial.** The protocol never holds unencumbered user funds. Deposits become shMON shares immediately. Per user per round principal is tracked on chain. There is no admin function that can move user funds.

**Non upgradeable.** No proxy. No upgrade key. The deployed contract is the contract. This eliminates upgrade related attack vectors at the cost of flexibility.

**No oracle dependency.** Winner selection uses Monad block hashes via a commit reveal scheme. No external oracle, no VRF subscription, no third party randomness assumption.

**Minimal admin surface.** The owner can pause, unpause, transfer ownership (two step), and update the ticket price between rounds. The owner cannot access user funds, change draw outcomes, alter committed parameters mid round, or interfere with claims and withdrawals.

---

## Verified source

The Vault A contract is verified on the Monad explorer. Vault B is verified the moment it deploys. Source code, constructor arguments, and compiler settings are public and independently checkable.

[Vault A on the explorer](https://monadexplorer.com/address/0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888?tab=contract)

---

## Responsible disclosure

If you find a vulnerability, contact the team privately before public disclosure. Contact details to be added.
