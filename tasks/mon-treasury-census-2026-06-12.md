# MON treasury census — 2026-06-12 (live on-chain reads)

All balances read live from `https://rpc.monad.xyz`. Context: operator asked "where are all my MON and what's sweepable."

## Keys (EOAs)

| Key | Address | Balance | Status |
|---|---|---|---|
| Ledger (owner) | `0xd399…84A2` | **2.998** | yours, liquid |
| Root key | `0x8487…91eD` | 0.177 | gas only — **still owner of both V3 vaults** (see below) |
| Fly keeper | `0x80dE…DBE9` | 3.373 | operational float — leave (target ~2, alarm at 0.5) |
| V4.1-A deployer | `0xFA5862…287A` | **2.411 — STRANDED, likely unrecoverable** | same filesystem search (2026-06-12) found no trace: `.openclaw/secrets/` empty, no keystore, no env file. Treat as written off unless a backup surfaces |
| Test wallet | `0x69b3F8…9EBc` | **10.309 — KEY EXPOSED** | found during key search (2026-06-12): its private key sits in **plaintext in `~/.bash_history`**, readable by any local process/agent/backup. Holds 10.31 MON on mainnet (nonce 43; the points-testing wallet). **Action: operator sweeps to Ledger, then purge the history line and retire the key.** Not previously in this census |
| V4.1-B deployer | `0x6b6601…FC5a` | 0.098 | **written off as unrecoverable deleted-key dust (2026-06-12, confirmed by exhaustive derivation).** Key search: `.openclaw/secrets/` empty (last modified 06-08, before the deploy), no foundry keystore, no `.env`/`/tmp` artifact, no file on disk references the address. Additionally, every 64-hex token in `~/.bash_history` and in the builder-agent session transcripts that mention this address was derived to an address — none matches this deployer (or V4.1-A's). The key existed only in the deploy-session environment (the 06-11 sweep of 1.2029 MON proves it existed then); the 0.097858 left behind is the standard ~0.1 MON sweep gas buffer. If the key ever surfaces, sweep; do not count this as recoverable. **Process deviation to fix:** the runbook required saving the key to `.openclaw/secrets/` — it never was. Same applies to the V4.1-A deployer below. |

## Contracts (native MON = VRF reserves)

| Contract | Address | Native MON | shMON (user funds) | Owner | Disposition |
|---|---|---|---|---|---|
| V3 Vault A | `0x8F36…B1ee` | **19.23** | 0 | root key | **recover now** — superseded, no principal |
| V3 Vault B | `0x56b4…1c41` | **19.23** | 0 | root key | **recover now** — superseded, no principal |
| V4-A (retired) | `0x9263…C7E8` | **8.23** | 0.638 | Ledger | recover per documented pending actions; 0.638 shMON = un-withdrawn depositor funds — verify before `stop()` |
| V4-B (active) | `0x08bd…2A3E` | 9.00 | 0 | Ledger | stays until V4.1-B cutover complete, then recover + `stop()` |
| V4.1-A | `0x933F…F7DA` | **0 — DEFECT** | 1.274 | Ledger | see incident below |
| V4.1-B (new) | `0x1886…404C` | 9.00 | 0 | Ledger | operational — leave (VERSION 4.1.0, EVRDRAW-B, owner already Ledger) |
| V2 A/B, legacy B, old V4-B, all oracles | — | 0 | ~0 | — | nothing to recover |

**V4.1-B identified on-chain:** vault `0x1886f329e486e934c76028B15a580850e74d404C` (deployer nonce 1), oracle `0xd5d43554CA158334d5Db4aEA745Ead986fAad5C5` (nonce 0). Needs its `deployments/monad-mainnet.json` + ADR-0032 entry.

## INCIDENT — V4.1-A has no VRF reserve and round 1 is stuck

- V4.1-A native balance is **0**: the 9 MON VRF reserve was **never seeded** (the deploy-log verification note even recorded "zero contract balance/reserve at cutover" — recorded but not acted on).
- `currentRoundId` is still **1**, four days after round-1 sales ended (2026-06-08T15:03Z). The round cannot settle without entropy fees.
- **1.274 shMON of user deposits** sit in the vault. Funds are not lost (withdrawals work per pool rules), but the product is stuck for those users.
- Fix: `depositVRFReserve()` is **owner-gated** (live call reverts `not owner` — corrected 2026-06-12; an earlier draft of this doc said permissionless). The **Ledger** must seed the 9 MON. Funding source: recovered V3 reserves (below) cover it without new operator capital, routed root key → Ledger → V4.1-A.

## Action plan (ordered)

1. **Recover V3 reserves (root key, 2 txs):** `withdrawVRFReserve` on both V3 vaults → 38.46 MON → send to Ledger. Then `stop()` both (zero shMON, no principal at risk). Root key has 0.177 MON gas — sufficient.
2. **Seed V4.1-A reserve (9 MON) — Ledger tx** (`depositVRFReserve()` is owner-gated) from the recovered funds → round 1 settles → product unstuck. This is the urgent one.
3. **Sweep V4.1-B deployer dust (0.098)** → Ledger; delete key only after sweep confirmed + balance read back.
4. **V4-A retired close-out:** after the 0.638 shMON depositor balance is withdrawn/expired per pool rules, Ledger `withdrawVRFReserve` (8.23) + `stop()` — this was already the documented pending action; balance record in deployments.json is stale (says 9, actual 8.23).
5. **Search backups for the V4.1-A deployer key** (`0xFA5862…287A`, 2.411 MON). If found: sweep → Ledger → delete. If not: write it off explicitly in an incident note so it stops appearing in future censuses as recoverable.
6. **V4-B (9.0):** no action until V4.1-B frontend/keeper cutover is verified live; then recover + retire per runbook.

## Net position

- Liquid now (Ledger): **3.00**
- **Gross** recoverable (steps 1–4): ~46.79 (38.46 V3 + 8.23 V4-A + 0.098 dust)
- **Net** back to Ledger after re-seeding 9 into V4.1-A: **~29.56 before V4-A closeout** (38.46 + 0.098 − 9), **~37.79 after** V4-A closeout adds 8.23. V4-A closeout and V4-B retirement stay gated on depositor-withdrawal / cutover verification respectively — do not pull those forward.
- Working capital that stays deployed: keeper 3.37, V4.1-B reserve 9.0, V4-B reserve 9.0 (until retirement), root-key gas 0.18
- At risk / possibly lost: **2.41** (stranded deployer) — pending key search
- User funds held by vaults (not yours): 1.274 shMON (V4.1-A) + 0.638 shMON (V4-A retired)
