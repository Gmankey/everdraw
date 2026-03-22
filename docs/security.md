# Security

## Audit status

EverDraw has not yet completed a formal third-party security audit. A comprehensive audit by a reputable firm is budgeted and planned before scaling TVL. The audit will cover both the current contract architecture and the Phase 2 TWAB system.

This documentation will be updated with the audit report link, scope, and findings when complete.

**We strongly recommend not depositing more than you are comfortable with until the audit is complete.**

---

## What has been validated

- 39/39 unit and integration tests passing
- Full round lifecycle (deposit → commit → draw → settle → claim → withdraw) validated on Monad testnet
- Keeper preflight system validated through a 24-hour burn-in with zero missed rounds
- ShMON integration tested through multiple full stake/unstake cycles
- Contract deployed and verified on Monad — source code is publicly readable

---

## Contract properties

**Non-custodial.** The protocol never holds unencumbered user funds. MON is immediately staked via ShMON on deposit, and principal tracking is per-user per-round. There is no admin function to move user funds.

**No upgradability.** There is no proxy pattern and no upgrade mechanism. The deployed contract is the contract. This eliminates upgrade-related attack vectors at the cost of flexibility.

**No house edge.** 100% of staking yield goes to the prize pool. EverDraw does not take a fee in Phase 1. (A small protocol fee is planned for Phase 4 when the vault factory launches.)

**No oracle dependency.** Winner selection uses Monad block hashes. No external oracle is required for draws, eliminating oracle manipulation risk.

**Minimal admin surface.** The owner can pause and unpause the contract and transfer ownership. That is the full extent of admin capability. The owner cannot access user funds, change draw outcomes, or modify per-round parameters.

---

## Verified source

The smart contract is fully verified on MonadVision. All source code, constructor arguments, and compiler settings are publicly readable and independently verifiable.

[View verified contract →](https://monadexplorer.com/address/0x[MAINNET_ADDRESS]?tab=contract)

---

## Responsible disclosure

If you discover a vulnerability, please contact the team privately before public disclosure. Contact: [security contact to be added]
