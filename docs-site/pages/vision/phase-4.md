# Phase 4 — Platform

**Timeline: Month 9–18**

EverDraw shifts from "we run prize pools" to "we are the prize pool infrastructure."

## Permissionless Vault Creation

Any team, protocol, or DAO deploys a prize vault with a single contract call via the EverDraw Vault Factory. Choose your asset, yield source, draw frequency, and parameters. No permission required.

ERC-4626 compatibility means any yield source following the tokenised vault standard plugs in automatically. If it earns yield on Monad, it can power an EverDraw prize vault.

Protocols can also deploy campaign vaults via `createCampaign()` — prize pools funded directly from treasury without needing a yield source at all. The factory supports both yield-driven and campaign-funded vaults from a single interface.

## Branded Partner Vaults

Protocols use EverDraw's infrastructure but own the user relationship:
- A lending protocol launches a "Prize Lending Vault"
- A DEX launches a "Prize LP Vault"
- A DAO parks treasury funds and runs a community prize pool

Each partner vault drives deposits into EverDraw's total ecosystem while giving the partner protocol a novel, low-friction user acquisition tool.

## Partner Analytics Dashboard

Protocols that run campaigns through EverDraw get a dashboard showing:
- Retention metrics (D1/D7/D30 user return rates)
- Repeat deposit rates
- Cost per retained depositor vs. traditional acquisition
- Campaign ROI across multiple draw cycles

This data turns prize campaigns from "experiment" into "measurable growth channel" — the proof point protocols need to commit recurring budget.

## Vault Discovery Marketplace

Users browse all active prize vaults on Monad by asset, yield rate, prize size, draw frequency, and depositor count. The marketplace makes EverDraw the destination for anyone asking "where should my idle assets work?"

## Protocol Revenue

EverDraw takes a small percentage of yield flowing through every vault. More vaults = more yield flowing = more revenue. The protocol grows with the Monad ecosystem without relying on token emissions or treasury drawdowns.

## Sponsored Deposits

Protocols deposit liquidity that contributes yield to the prize pool without earning prize chances. This boosts prizes for real users and gives protocols a new way to support ecosystems they're aligned with.

## The Network Effect

More vaults → bigger prizes → more users → more demand for new vaults → more protocols launch vaults.

At this stage, EverDraw doesn't need to create every vault. The ecosystem creates them. EverDraw provides the rails.
