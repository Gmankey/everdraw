# V5 independent root-watcher + veto drill evidence — 2026-08-08

**Gate:** M8 independent watcher, alert delivery, guardian veto, corrected-root verification, and
unattended recovery. **Network:** Monad testnet (`10143`).

## Target

- DrawManager: `0xF7c5ED046A829FE153486C306dd0DF7EBB037C19`
- ClaimManager: `0x7b614F7df10b38857bFbd70c43a7B7cef816dC24`
- PrizeVault: `0xFAF8d7Fea6CA039f4f5dd1449477A4d8836Ed9A0`
- Draw: `137`

## Deliberate mismatch and detection

- Guarded bad-root proposal transaction:
  `0xb22e1c4506fbea928fa2851ffc2f98643c1126be9b078b3fa1ae82a0edb29b96`
- Deliberately proposed root:
  `0x517d93843355fee01dc35699c3148b50def8ed8053cdd929a05330e7c566ffbf`
- Independently recomputed root:
  `0x396ea54b4a06c4eed0c4ab0824c12e27457816ce6268db4820b46de53626deab`
- Watcher mismatch run: GitHub Actions `31173063910`.
- Operator observed the Telegram mismatch alarm with the draw id, both roots, and Ledger veto
  instruction.

## Guardian veto

- Guardian Ledger transaction:
  `0x9de1e3a1a1f0a33747749a8e969ecf23bf15fcccea25500cda527b226dd15de2`
- Receipt status: success. `RootVetoed` emitted for draw 137.
- Post-veto state: `Seeded`; root, winner count, proposal timestamp, and proposer cleared.
- One-hour veto cooldown was respected before the keeper restarted.

## Corrected lifecycle

- Correct-root proposal transaction:
  `0xaaa5c9301271d101edb878f74275c5ef9da22ece13a2593f617f333b1c67d9bb`
- Corrected root:
  `0x396ea54b4a06c4eed0c4ab0824c12e27457816ce6268db4820b46de53626deab`
- Independent watcher run:
  `https://github.com/Gmankey/everdraw/actions/runs/31257494021`
  - scanned the delta through block `51953354`;
  - checked exactly one new `RootProposed` event;
  - completed successfully with no mismatch alarm.
- Draw 137 advanced to `Finalized` after the 15-minute challenge window.
- Keeper `claimMany(137)` transaction:
  `0xe22af1eb77e3ce2a101501b8a37a71ffe64e5f9808ac35e35ee17e90ae5b254e`
  - receipt status: success;
  - emitted `ClaimPaid` and `PrizeCompounded` for winner
    `0xA2da36390F94b8dEfEe5b13bc0B4698A5e2eBD1B`;
  - compounded amount: `8444619304151731` shMON shares.

## Operational recovery

- Keeper restarted as the managed Fly machine, not from a terminal.
- Persistent cache processed the six-day stopped interval once, then returned to delta scans.
- Keeper remained healthy and advanced the DrawManager through draw 146 during final verification.

## Result

The independent watcher detected a malicious-root simulation, delivered the operator alert, and
the guardian veto path was exercised from the Ledger. The managed keeper then recovered without a
manual lifecycle transaction, proposed the independently matching root, finalized the draw, and
auto-compounded the prize. This M8 gate is complete.
