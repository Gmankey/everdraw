# ADR-0032 - V4 Mainnet Launch Record

**Status:** Accepted  
**Date:** 2026-06-03  
**Network:** Monad mainnet, chain ID 143  

## Summary

EverDraw V4 launched on Monad mainnet with two native-MON vaults and one Pyth randomness adapter per vault.

Both V4 vaults use committed source from `origin/staging` at commit `8c13f69f2af202b5f7a9688fd3a975f2d21097d3`, compiler `solc 0.8.33`, optimizer 200, `viaIR=true`, and `evmVersion=paris`.

## Common Configuration

- Deposit mode: native MON (`depositMode = 0`)
- Asset: `0x0000000000000000000000000000000000000000`
- Yield vault / shMON: `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`
- Pyth Entropy: `0xD458261E832415CFd3BAE5E416FdF3230ce6F134`
- Pyth provider: `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506`
- Ticket price: `1000000000000000000` wei, 1 MON
- Round duration: `86400` seconds
- Yield period: `518100` seconds
- Winners: 1
- Winner allocation BPS: `[10000]`
- Owner / pauser after launch: `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2`
- Fly keeper: `0x80dE4674dEFC68F06F4772B8Ec2F89aBda43DBE9`
- VRF reserve seeded: `9 MON` per vault

## Vault A V4

- Vault: `0x9263d84a141172d9618f4b08839f595EE03bC7E8`
- Oracle: `0xB06d11dF2B6b351DFF64f3270e7C7F8cd43fe799`
- Symbol: `EVRDRAW-A`
- Deployer: `0x8e56E989f9108F90D0a33F202270365931BE4811`
- First `RoundStarted` block: `78796629`
- First `RoundStarted` tx: `0x4f48b7346ff4c6d43ac688ee16045107c52c87ea94d7c079cee78ade952e15fa`
- First `RoundStarted` timestamp: `2026-06-03T06:10:23.000Z`
- First sales end time: `1780553423`
- Vault runtime bytecode SHA-256: `9952102a28c455763d48e4ee7a77042168dfa9ad3e9ea1618e89c19aadb0a280`
- Oracle runtime bytecode SHA-256: `654a35b8f7df518076b0c211aae3549d5cebaa44259764b8f8480dd38cf09942`

Post-deploy role transactions:

- `depositVRFReserve(9 MON)`: completed
- `setKeeper(0x80dE4674dEFC68F06F4772B8Ec2F89aBda43DBE9, true)`: completed
- `setKeeper(deployer, false)`: completed
- `setPauser(0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2)`: completed
- `transferOwnership(0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2)`: completed
- `acceptOwnership()`: completed from Ledger

## Vault B V4

- Vault: `0x0032c9F6621Ef5d53b48dc602D4d056d7a47c5fF`
- Oracle: `0x1eE7502BD22940523aE504dF9855aBc0c417347d`
- Symbol: `EVRDRAW-B`
- Deployer: `0x84875804608467B3577605c0976dC645739091eD`
- First `RoundStarted` block: `78804885`
- First `RoundStarted` tx: `0xb18cf05ecc690c231b41903cca7c92fcab687745c9abca1a029120415f89dda8`
- First `RoundStarted` timestamp: `2026-06-03T07:05:22.000Z`
- First sales end time: `1780556722`
- Vault runtime bytecode SHA-256: `9952102a28c455763d48e4ee7a77042168dfa9ad3e9ea1618e89c19aadb0a280`
- Oracle runtime bytecode SHA-256: `e2eaf9ba29592089f701a8af54e9b1adc4521ab2c839965b8ab7e9d8ff95fe09`

Post-deploy role transactions:

- `depositVRFReserve(9 MON)`: `0x9965075989ec2fb18540d3b20ba2a41c9849dfb4252a5ec3e0ebc1762f9c9286`
- `setKeeper(0x80dE4674dEFC68F06F4772B8Ec2F89aBda43DBE9, true)`: `0xb5621b219dadb3507f48eada2912cb4c0dcc3bc159cade37e51e6afd2ee1c3e4`
- `setKeeper(0x84875804608467B3577605c0976dC645739091eD, false)`: `0x047cf60fdcccd4df02e038c699fb7a4d2cee90edfd45eb3d6cd1e375bdf6e4c2`
- `setPauser(0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2)`: `0x64b02c7653c951290f7dbd71d1acfca889024b367155394fc1ff9b1643a6027f`
- `transferOwnership(0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2)`: `0xa5727e5f4e111aa353b6dfa8fb4cbc17aa2d881923f787011cfff0d86e621ceb`
- `acceptOwnership()`: completed from Ledger

## Verification

Immediate post-launch checks:

- V4-A owner: `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2`
- V4-B owner: `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2`
- V4-A pending owner: zero address
- V4-B pending owner: zero address
- V4-A pauser: `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2`
- V4-B pauser: `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2`
- V4-A Fly keeper allowed: true
- V4-B Fly keeper allowed: true
- V4-A deployer keeper allowed: false
- V4-B deployer keeper allowed: false
- V4-A reserve: `9 MON`
- V4-B reserve: `9 MON`

## Incident Notes

The throwaway V4-A deployer key was not persisted in the expected local config after V4-A. The wallet `0x8e56E989f9108F90D0a33F202270365931BE4811` remained funded but unusable from this runtime. Recovery used the existing EverDraw deployer `0x84875804608467B3577605c0976dC645739091eD`, which was locally configured and funded for V4-B.

Future deployer generation must write the private key to a named local secret file before requesting funding, then verify the derived public address from that file before sending the address to the operator.

## Deployer Balance Cleanup

After V4-B ownership was accepted, `1 MON` of the remaining balance on `0x84875804608467B3577605c0976dC645739091eD` was returned to the Ledger owner.

- Refund tx: `0xfa2435a58212f034e7d61bc133fe6ece2b573952fa68ab7bff59c89beb03e587`
- Remaining deployer balance after refund: approximately `0.1767 MON`
