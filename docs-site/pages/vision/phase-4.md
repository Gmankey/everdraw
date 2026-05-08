# Phase 4: Platform

**Timeline: month 9 to 18.**

EverDraw shifts from "we run prize pools" to "we are the prize pool infrastructure."

## Permissionless Vault Creation

Any team, protocol, or DAO deploys a prize vault with a single contract call to the EverDraw Vault Factory. Choose your asset, yield source, draw frequency, and parameters. No permission required.

ERC 4626 compatibility means any yield source following the tokenised vault standard plugs in automatically. If it earns yield on Monad, it can power an EverDraw prize vault.

Protocols can also deploy campaign vaults via `createCampaign()`. Prize pools funded directly from treasury without needing a yield source. The factory supports both yield driven and campaign funded vaults from one interface.

## Branded Partner Vaults

Protocols use EverDraw's infrastructure but own the user relationship.

- A lending protocol launches a "Prize Lending Vault."
- A DEX launches a "Prize LP Vault."
- A DAO parks treasury funds and runs a community prize pool.

Each partner vault drives deposits into EverDraw's total ecosystem while giving the partner a low friction user acquisition tool.

## Partner Analytics Dashboard

Protocols running campaigns get a dashboard with:

- Retention metrics (D1, D7, D30 return rates)
- Repeat deposit rates
- Cost per retained depositor vs traditional acquisition
- Campaign ROI across draw cycles

This turns prize campaigns from "experiment" into "measurable growth channel," which is the proof point protocols need to commit recurring budget.

## Vault Discovery Marketplace

Users browse all active prize vaults on Monad by asset, yield rate, prize size, draw frequency, and depositor count. The marketplace makes EverDraw the destination for "where should my idle assets work?"


## Sponsored Deposits

Protocols deposit liquidity that contributes yield to the prize pool without earning prize chances. Boosts prizes for real users and gives protocols a way to support ecosystems they are aligned with.

## The Network Effect

More vaults make bigger prizes. Bigger prizes attract more users. More users create demand for new vaults. More protocols launch vaults.

At this stage, EverDraw does not need to create every vault. The ecosystem creates them. EverDraw provides the rails.
