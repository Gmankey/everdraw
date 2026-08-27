# V5 external-audit H-05 remediation

**Implements:** ADR-0042 section 7
**Source:** EverDraw V5 External Project Audit Report, H-05 (2026-08-26)

## Scope

- make TWAB ownership two-step, matching the vault, DrawManager, and ClaimManager
- require pairwise-distinct deployer, final owner, guardian, pauser, and keeper roles
- nominate the final Ledger EOA or multisig only after wiring and bytecode verification
- prevent activation until all four ownership acceptances are independently receipt-verified and recorded
- require the final owner to commit the delayed DrawManager activation
- monitor pending/completed ownership transfers and every emitted V5 privileged configuration change

## Acceptance

- the deployer remains owner only while all four contracts show the approved final owner as pending
- every acceptance receipt succeeds, targets/executes through the expected actor, emits the expected event, and matches final on-chain owner state
- deployment status cannot reach `draw-manager-committed` through an ownership-pending record
- the append-only deployment record contains nomination, acceptance, and activation transaction hashes
- the deployer, final owner, guardian, pauser, and keeper cannot overlap
- the strategy's deployer-only initializer is provably inert after its vault is pinned
- Forge, deploy-script, watcher, and source/bytecode gates remain green

## External dependencies and failure behavior

- **Final Ledger EOA or multisig:** if it cannot accept all four contracts, the deployment stays inactive.
- **Monad RPC:** receipt or owner-state uncertainty fails recording; it never advances status optimistically.
- **Independent watcher/GitHub Actions:** a monitoring outage blocks launch signoff; contracts remain unaffected.
- **Deployment manifest:** malformed or missing ownership evidence is rejected by keeper/watcher/frontend deployment selection.
