# Version Updates

## V5

V5 replaces retired V4 round vaults with continuous deposits and withdrawals, weekly TWAB-weighted draws on mainnet, fixed shMON-share prize escrow, challengeable Merkle roots, managed keeper execution, an independent root watcher, Patron deposits, and tranche-based points.

Important V5 behavior:

- withdrawals return shMON shares; MON conversion is external through shmonad.xyz
- prize winnings normally auto-compound into fresh tenure-zero vault tranches
- History WINNER rows are informational, not claim buttons
- participant and Patron accounting are separate
- indexer data is scoped to a complete deployment tuple and active vault
- configuration and bytecode verification are launch gates

Use the current deployment manifest and V5 ABIs for new integrations.

## V4 and earlier

All mainnet V4 pools have been stopped and the legacy V4 keeper retired. Their contracts and events remain historical records, not the integration target for new products.
