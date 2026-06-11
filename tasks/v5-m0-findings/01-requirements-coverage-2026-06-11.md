# M0 Pass 1 — Requirements Coverage

**Scope:** ADR-0034 R0-R6, all four sponsor models, and the ADR-0036 §6 V5.1 seam.

## Trace

| Requirement | Design coverage | Result |
|---|---|---|
| R0 continuous deposits / TWAB | ADR-0036 §1 D1, §3.1 TwabController, §3.2 continuous deposits/withdrawals, §3.4 cadence, §4 winner selection, UX spec §§1-3 | Covered |
| R1 flexible yield sources | ADR-0036 §3.3 `IYieldStrategy`, strategy swap timelock, value-delta accounting | Covered for V5.0 shMON, extensible for later adapters |
| R2 decoupled reward asset | ADR-0036 §3.5 distributions, §5.2, §5.4 5a/5b, §6 CampaignManager seam | Covered |
| R3 rebasing-token support | ADR-0036 §3.3 value accounting, §3.5 escrowed fixed payouts, §5.4 hard allowlist excluding rebasing reward tokens | Covered; reward-token rebasing explicitly rejected for V5.0 |
| R4 mass winner distribution | ADR-0036 §3.5 merkle distributions, §4.1 with-replacement algorithm, build plan M3/M4 load/gas gates | Covered |
| R5a reward-token donation | ADR-0036 §5.4 `fundPrize(token, amountPerDraw, numDraws)` | Covered |
| R5b same-token unstaked direct reward | ADR-0036 §5.4 deposit-asset `fundPrize` held raw | Covered |
| R5c principal-retaining yield-only recurring sponsor | ADR-0036 §3.2 `sponsorDeposit`, §5.4 delegate-to-zero | Covered |
| R5d sponsor principal redemption | ADR-0036 §5.4 ordinary non-pausable withdrawal | Covered |
| R6 fee flexibility | ADR-0036 §5.3 fee-base flag, value-delta fee, in-kind multi-token fee leaves | Covered |
| V5.1 seam | ADR-0036 §6 distribution registry, `distributionId`, metadata eligibility binding, `fundPrize`, TwabController reads, algorithm versioning | Covered after this PR's sponsor-TWAB read clarification |

## Findings

No remaining coverage blocker after the amendments in this PR.
