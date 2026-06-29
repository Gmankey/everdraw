# PoolTogether TWAB Lineage

`EverdrawTwabController.sol` adapts the cumulative-balance ring-buffer model from
PoolTogether V5 TWAB Controller.

- Source repository: `https://github.com/GenerationSoftware/pt-v5-twab-controller`
- Source commit reviewed/adapted: `29926961b2ecfa89e0f61a6d874c71b6f8e29112`
- License: MIT
- Copyright notice from upstream:
  `Copyright (c) 2023-2024 G9 Software Inc.`

EverDraw changes for V5.0 M1:

- removed transferable-ticket and user-facing delegation APIs;
- restricted writes to owner-registered vaults;
- added explicit zero-odds delegate accounting through `SPONSOR_DELEGATE` and `BOOSTER_DELEGATE`;
- exposed separate participant-total TWAB and delegate TWAB reads;
- inlined minimal ring-buffer helpers instead of adding new vendored dependencies.
