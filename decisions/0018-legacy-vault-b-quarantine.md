# ADR-0018 - Legacy Vault B quarantine

**Status:** Accepted
**Date:** 2026-05-22

## Context

Legacy Vault B at `0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a` is still relevant for in-flight settlement and withdrawals, but it is not the design source for any future contract work.

During the production source-control hardening pass, the live runtime bytecode was fetched and hashed:

```text
address: 0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a
runtime sha256: 220cafb32f6c2d8ca7587b6fa6cd388434a007875e643a230b6f39db82a7a8c3
```

The current committed source/artifacts and available local backup artifacts did not match that live runtime bytecode.

## Decision

Mark `0xed67...` as `unverified-retiring` in `deployments/monad-mainnet.json`.

It may be monitored for settlement/claims during retirement, but it must not be used as source for:

- V3/VRF design.
- Vault B replacement design.
- Frontend accounting assumptions.
- Keeper behavior assumptions beyond direct on-chain reads.
- Any new deployment.

## Consequence

The only verified active production implementation source of truth is Vault A:

`0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888`

with source `src/TicketPrizePoolShmonV2.sol` and verification evidence in ADR-0016.

If exact `0xed67...` behavior is ever needed, it must be recovered and bytecode-verified before use. Until then, it is quarantined.
