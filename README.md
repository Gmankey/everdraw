# EverDraw

EverDraw is Monad's prize-linked savings protocol. Users deposit MON, the vault converts it to shMON shares, yield funds the prize, and depositors keep principal exposure through the round.

## Canonical Mainnet Deployments

Use this section as an out-of-band check if `everdraw.xyz` ever looks suspicious. Always verify that any transaction signed through the frontend targets one of the addresses below or an address listed in [`deployments/monad-mainnet.json`](deployments/monad-mainnet.json).

| Role | Address | Status |
|---|---|---|
| Vault A V3 | `0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee` | Active |
| Vault B V2 | `0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d` | Active interim Vault B until V3 B deploy |
| Vault A V2 | `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888` | Retiring |
| Legacy Vault B | `0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a` | Retiring / monitoring only |
| shMON | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` | Principal asset |
| Pyth Entropy | `0xD458261E832415CFd3BAE5E416FdF3230ce6F134` | V3 randomness contract |
| Pyth Entropy provider | `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506` | V3 randomness provider |

Runtime bytecode hashes, constructor args, ABIs, and verification notes live in [`deployments/monad-mainnet.json`](deployments/monad-mainnet.json). The security and dependency model is summarized in [`docs-site/pages/security.md`](docs-site/pages/security.md).

## Supported contracts

**Supported contracts:** production support is currently limited to the deployed EverDraw V2/V3 vaults listed in the canonical deployment table and manifest. Earlier iterations (`TicketPrizePool`, `TicketPrizePoolShmon`, `PrizeVault`) were removed from this repository as of PR 2; they were not in production and carried security issues that were not worth fixing in place. See `security_audit/AUDIT_REPORT_2026-04-08_v1-era.md` for detail.

## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
