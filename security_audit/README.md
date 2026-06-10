# Security Audits

Historical and current audit reports for EverDraw.

**For the current production review, read [`AUDIT_REPORT_V4_2026-06-05.md`](./AUDIT_REPORT_V4_2026-06-05.md).** That is the authoritative internal review against the current V4/V4.1 production contract line deployed on Monad mainnet.

The older report (`AUDIT_REPORT_2026-04-08_v1-era.md`) is preserved for historical and audit-trail purposes only. Its critical findings either drove the V2/V3 redesigns or apply to contracts that are no longer in production use. A banner at the top of that file explains what changed since.

## Reports

| Report | Date | Scope | Status |
|---|---|---|---|
| [`AUDIT_REPORT_V4_2026-06-05.md`](./AUDIT_REPORT_V4_2026-06-05.md) | 2026-06-05 | `TicketPrizePoolV4` and V4.1 additive shMON-deposit update | **Current** — no critical/high/medium findings at high confidence |
| [`AUDIT_REPORT_V3_2026-05-28.md`](./AUDIT_REPORT_V3_2026-05-28.md) | 2026-05-28 | `TicketPrizePoolShmonV3` at commit `186f1ad` | **Past internal review** — no HIGH/MEDIUM findings at confidence ≥ 8 |
| [`AUDIT_REPORT_2026-04-08_v1-era.md`](./AUDIT_REPORT_2026-04-08_v1-era.md) | 2026-04-08 | V1-era contracts (`TicketPrizePoolShmonShMonad`, `TicketPrizePool`, `TicketPrizePoolShmon`, `PrizeVault`) | **Historical** — superseded by V2/V3 architecture changes documented in ADRs 0010, 0014, 0015, 0016, 0018, 0019 |

## How to read these

- **Operators / new contributors:** start with the V4 report. The V3 and V1-era reports are historical context for why the current architecture exists.
- **Third-party auditors:** read all reports. The historical reports establish the threat-model lineage; the V4 report establishes the current contract surface. Cross-check the current report against the ADRs and deployment manifest that are cited.
- **Users:** the V4 report's executive summary in §1 is the high-confidence statement of the current protocol's internal-review posture. The full report is for engineers.

## Future audits

A third-party human audit is budgeted and planned before TVL scales beyond bootstrapping levels (>1000 MON in any single vault). When complete, that report will be added to this directory and the V4 internal report will move into a "Past internal reviews" subsection rather than being promoted as the canonical reference.

## Related

- All ADRs that respond to findings or define the trust surface: [`decisions/`](../decisions/)
- Live trust model and operational mitigations: [`decisions/0022-operational-trust-assumptions.md`](../decisions/0022-operational-trust-assumptions.md)
- Working rule that requires audits to enumerate external dependencies: [`memory/working_rule_external_dependencies.md`](../memory/working_rule_external_dependencies.md)
