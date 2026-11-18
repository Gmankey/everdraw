# PR #330 R330-08/R330-09 remediation handoff

Date: 2026-11-18 (Australia/Sydney)

## Containment

- Mainnet keeper remains stopped.
- Mainnet watcher remains disabled.
- No live qualification, paid RPC call, deployment or secret change was made.

## R330-08 closure

The keeper now creates and authenticates one static-network write provider at process startup and reuses it across all lifecycle loops. `runOnce` cannot create or validate a write provider. Idle loops make no gateway call. A process restart performs exactly one fresh authenticated chain check.

Regression evidence uses the actual keeper provider and actual gateway implementation. Three idle cycles consume one `eth_chainId` reservation total; a simulated process restart increases the total to two, not six or a per-loop count. Wrong authentication still fails closed.

## R330-09 closure

Actions cache is no longer used for qualification admission. The paid-egress gateway now hosts a separate authoritative qualification admission ledger on its single persistent volume.

- State is explicitly operator-initialized and hash-bound to reviewed policy.
- Missing/corrupt state fails closed; normal execution never creates a zero-usage state.
- Provider identity, billing period, aggregate cap, attempt cap and cooldown are policy-bound.
- An identical qualification ID resumes retained usage only when commit/provider identity match.
- A new ID obeys cooldown and remaining aggregate allowance.
- Every upstream qualification request first obtains a durable reservation from the gateway.
- Runner termination after reservation conservatively retains usage.
- Qualification workflow contains no cache restore/save path.

New policy/admin files:

- `scripts/rpc/qualification-admission.mainnet.json`
- `scripts/rpc/qualification-admission-admin.mjs`
- `scripts/rpc/qualification-admission-ledger.mjs`

## Dependency advisory triage

GHSA-fc5q-39xc-vjpf currently has no published patched `picomatch` release; npm reports `4.0.7` as latest while the advisory includes versions through `4.0.7`.

Reachability:

- Root: only Hardhat -> tinyglobby/fdir development build/test tooling.
- Web: Vite build tooling plus an `unstorage` optional matching chain; `picomatch` is absent from the generated browser artifact.
- Docs: Nextra/ts-morph static documentation build tooling.
- EverDraw accepts no user-supplied glob or extglob patterns in these paths. The advisory requires attacker-controlled pathological matching patterns.

Disposition requested from auditor: approve a temporary reachability exception until an upstream patched release exists. No forced major downgrade/upgrade is proposed. Re-run audit at final head and remove the exception as soon as a compatible patched release is published.

## Focused tests

- Qualification admission: cold/missing state failure, restart persistence, same-ID bounded resume, cooldown, aggregate cap, gateway authentication and pre-request durable reservation.
- Keeper: actual gateway startup validation, three idle cycles with no extra reservations, process restart, wrong-token failure.

Final local results:

| Suite | Result |
|---|---:|
| RPC/gateway/qualification admission | 21 passed |
| Keeper/deployment/supervisor | 28 passed |
| Watcher/cache/reorg/participants | 44 passed |
| Indexer | 34 passed |
| Hardhat compile | passed |
| Indexer TypeScript build | passed |
| Web production build and RPC-secret scan | passed |
| Docs production build | passed |
| Browser artifact search for `picomatch`/`extglob` | no matches |

## Operational prerequisites after code approval

1. Configure protected GitHub environments `v5-mainnet-rpc-qualification` and `v5-mainnet-recovery`.
2. Review/fill both gateway policy files, initialize both persistent ledgers once, and record both policy/state hashes.
3. Verify exactly one gateway machine and one authoritative volume.
4. Run one approved qualification; restore watcher coverage before separately approving keeper restart.
