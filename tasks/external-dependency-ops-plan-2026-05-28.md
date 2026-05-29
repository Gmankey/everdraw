# External Dependency Resilience — Ops Plan

**Date:** 2026-05-28
**Trigger:** Post-V3-audit review surfaced six external-dependency gaps that the contract-correctness audit had not addressed.
**Goal:** Close the four gaps that have current-day actions. Document the rest as Phase 2 work tied to ADRs.

---

## Status as of writing

| # | Gap | Status |
|---|-----|--------|
| 1 | shMON pause could brick fee transfer | ✅ Already mitigated — `feeBps = 0` verified on-chain (Vault A V3); ADR-0023 codifies the policy |
| 2 | No multi-VRF abstraction (`IEntropy` is Pyth-specific) | ⏳ Phase 2 (V4 contract) — PM to write ADR before implementation |
| 3 | DNS hijack on `everdraw.xyz` | ✅ Repo-side publication added to README; operator still needs Twitter/X + Discord |
| 4 | No succession plan if operator is incapacitated | 🔲 Sealed succession document + multisig migration (this plan) |
| 5 | No backup RPC configured | ✅ Keeper/indexer fallback shipped in PR #60; operator must verify Fly runtime |
| 6 | No automated alert on governance events | ✅ Alert watcher shipped in PR #60; operator must deploy/scale and smoke test |

This document covers gaps **3, 4, 5, 6** with concrete actions. Gaps 1 and 2 are tracked elsewhere.

---

## Action 1 — Configure backup Monad RPC (gap 5)

**Why:** `rpc.monad.xyz` is a single point of failure. If it goes down, the keeper, indexer, and frontend all lose chain visibility. The contract keeps running, but no off-chain service can read it.

**Time:** 30 minutes.

### Steps

1. Sign up for **two** alternative Monad mainnet RPC providers. As of the time of writing, options include:
   - Alchemy (if they support Monad mainnet)
   - QuickNode
   - Ankr
   - Blockpi
   - dRPC

   Pick at least two. Both should be free-tier or paid based on traffic.

2. Test each one with a basic call:
   ```bash
   curl -s -X POST <RPC_URL> -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```
   Expected response: a recent block number. Compare against `rpc.monad.xyz` to confirm the alt RPC isn't significantly lagged.

3. Configure the **keeper** (canonical now lives in Fly secrets, not local env):
   ```bash
   flyctl secrets set -a everdraw-keeper \
     RPC_URL_FALLBACK='https://<your-first-backup-rpc>'
   ```
   Keeper code already supports `RPC_URL_FALLBACK` (currently empty). Verify the keeper uses it correctly by tailing logs after the restart for any failed-then-succeeded RPC calls.

4. Configure the **indexer**:
   ```bash
   flyctl secrets set -a everdraw-indexer \
     RPC_URL_FALLBACK='https://<your-second-backup-rpc>'
   ```
   If the indexer doesn't currently support a fallback in code, file a follow-up ticket. (Verify by reading `scripts/indexer/src/runner/service.ts` for any `RPC_URL_FALLBACK` reference. If absent, this is a builder ticket: "indexer: honor RPC_URL_FALLBACK when primary RPC errors persist.")

5. Configure the **frontend**: the frontend currently inherits the connected wallet's RPC. This is fine for read paths because the wallet handles routing. For the small number of direct reads the frontend does, optionally set `VITE_RPC_URL` to a public RPC.

6. Document the configured backup providers in `tasks/disaster-recovery-runbook.md` under a new "Backup RPCs" section.

### Verification

- Temporarily block `rpc.monad.xyz` on a test machine (or shut off the primary in env) and confirm keeper continues operating from the fallback.
- Keep the two backup RPCs in rotation for emergency use only — they should not be the primary as long as `rpc.monad.xyz` is healthy.

---

## Action 2 — Publish canonical addresses out-of-band (gap 3)

**Why:** If `everdraw.xyz` is hijacked at the DNS layer, an attacker can serve a malicious frontend that crafts transactions users believe are safe (e.g., `approve` for shMON drain, or a `setFee` impersonation). The contract is unchanged but users would be tricked.

**Mitigation strategy:** Publish the canonical contract addresses, ABIs, and the runtime bytecode hashes in **multiple out-of-band channels** so any user can verify they're not being phished. The redundancy is the protection — an attacker can't hijack all of them simultaneously without an extraordinary effort.

### Channels to publish to

1. **GitHub repo README** (`README.md` at root):

   ```markdown
   ## Canonical Mainnet Deployments

   | Vault | Address | shMON | Pyth Entropy | Status |
   |-------|---------|-------|--------------|--------|
   | Vault A V3 | `0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee` | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` | `0xD458261E832415CFd3BAE5E416FdF3230ce6F134` | Active |
   | Vault B V3 | (pending Sun 2026-05-31) | same | same | Scheduled |
   | Vault B V2 (legacy) | `0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d` | same | n/a | Active until Vault B V3 deploys |

   Always verify any transaction signed at https://everdraw.xyz interacts with one of these addresses.

   Bytecode hashes and constructor args: see `deployments/monad-mainnet.json`.
   ```

   Commit this in the same PR as the rest of this ops plan.

2. **Project Twitter / X account** — pinned tweet listing contract addresses + a link to the repo deployment manifest. Update the pin whenever a new vault deploys.

3. **Discord announcements channel** — sticky message with the same info.

4. **ENS or domain TXT record** — set a TXT record on `everdraw.xyz` (or an EverDraw-owned ENS name) containing the contract addresses. Sophisticated users can `dig TXT everdraw.xyz` to verify. **Only useful if the DNS hijack scenario you're guarding against is for the web traffic, not the DNS record itself.** Lower priority.

5. **Monad block explorer "Verified Contract" page** — already happens via standard verification. Once Monadscan supports contract source verification, submit the V3 source.

### Process

- The Twitter/Discord posts and README update should be done once now, then re-done after each deploy.
- Build the discipline: every contract deploy includes a post-deploy step to update the canonical addresses in all 4 channels.
- Add this step to `tasks/v3-vault-b-deploy-runbook-2026-05-31.md` and any future deploy runbook.

### Verification

Run yourself through the user-side verification flow:

1. Visit `https://everdraw.xyz` on a fresh browser.
2. Look at the address shown for "Vault A V3" in the UI.
3. Open a separate tab, go to GitHub repo README, confirm the address matches.
4. Open Twitter pinned post, confirm match.
5. If any of these don't match, you'd have caught a phishing attempt.

If a user doesn't know to do this, the protection is weak. Consider adding a one-line note to the frontend: "Always verify the contract address on our GitHub: link." Increases user awareness.

---

## Action 3 — Sealed succession document (gap 4)

**Why:** If the operator is incapacitated, the owner key in their MetaMask seed is the only way to:
- Change the protocol fee (which is currently 0 — would need to change if redirecting to a treasury)
- Migrate the Pyth Entropy provider via the timelock if Pyth deprecates
- Withdraw the VRF reserve
- Pause in an emergency
- Rotate the keeper hot wallet

Without recovery, the protocol keeps running on the existing config until natural end-of-life. No catastrophic loss, but no ability to respond to anything.

**Time:** 1 hour, plus delivery logistics.

### What goes in the sealed document

Plain-text instructions on physical paper, in an opaque envelope, stored somewhere a designated recovery contact can access only under specific conditions (e.g., death, prolonged hospitalization).

The document should contain:

1. **Plain-English explanation of EverDraw.** Two paragraphs. What the protocol is, who depends on it (depositors), and why this recovery exists.
2. **Recovery contact instructions.** Who should be notified first (a co-founder, an advisor, a family member). Their contact info. What they're being asked to do.
3. **Location of the MetaMask seed phrase.** Either embedded directly (encrypted with a password the contact knows) or pointer to where the seed lives (safe deposit box at <bank>, hardware wallet in <location>, etc.).
4. **Location of secondary keys** (keeper hot wallet, Fly account access, Vercel account access, GitHub account credentials). These can be recovered separately if MetaMask is intact.
5. **Pointer to the codebase + ADRs.** "Read `decisions/` in the repo first. Read ADR-0022 for the trust model. Read `tasks/disaster-recovery-runbook.md` for the operational playbook."
6. **List of trusted advisors/co-signers** who can help interpret the situation if the contact doesn't have crypto background.

### Logistics

Two reasonable approaches:

**Approach A: Solo founder, one trusted person.** A sealed envelope with the contact, stored alongside your will or with your lawyer. The contact opens it under specified conditions. Single point of failure on that one contact.

**Approach B: Two-of-N reveal.** Document is split using Shamir's Secret Sharing into N pieces, any 2 of which can reconstruct it. Pieces distributed to different trusted parties. Requires more setup but resistant to one party becoming hostile or losing their piece. Tools like `slip39` can do this.

For a solo founder at current TVL: **Approach A is fine.** Upgrade to Approach B (or skip directly to multisig) when TVL or complexity grows.

### Action items

1. Draft the document in plain text. Print on paper. Sign and date.
2. Place in opaque envelope. Mark "OPEN ONLY IN EVENT OF MY DEATH OR PROLONGED INCAPACITATION — CONTAINS INSTRUCTIONS FOR EVERDRAW PROTOCOL RECOVERY".
3. Deliver to the chosen contact OR safe deposit box with instructions.
4. **Do not commit any version of this document to git.** Even encrypted. It contains references to (and possibly the value of) the MetaMask seed.
5. Set a calendar reminder to **review and update once per year** — addresses, contacts, and procedures drift.

### Multisig migration (the longer-term answer)

The sealed-document approach is a 1-of-1 recovery patch. The proper solution is migrating the owner role to a 2-of-3 Safe multisig (already tracked in ADR-0022 "Open follow-ups"). When you're ready:

1. Pick three signers per the criteria in this conversation (trustworthy, reachable, crypto-literate, geographically separated).
2. Deploy a Safe at `https://safe.global` against Monad mainnet (or wait for Monad-native Safe support).
3. Add all three signer addresses; set threshold to 2.
4. Test the Safe with a low-value operation (e.g., a transfer of 0.1 MON to yourself).
5. On each V3 vault: call `transferOwnership(safeAddress)` from the current owner. The Safe must then call `acceptOwnership` (this is a multisig tx requiring 2 signatures).
6. Once accepted, the Safe is owner of every vault. Single-key risk is gone.
7. Document the Safe address, the signer addresses, and the signing procedure in a new ADR (ADR-0027 or similar, post-launch).

This migration should happen within 3 months of mainnet launch per ADR-0022.

---

## Action 4 — Automated governance event alerts (gap 6)

**Why:** If the owner key is compromised, the attacker's first move is likely to be one of:
- `transferOwnership(attackerAddress)` — but this requires `acceptOwnership` so a 2-step
- `queueEntropyChange(maliciousEntropy, maliciousProvider)` — sets up a chosen-randomness attack 24h out
- `setFee(2000, attackerAddress)` — diverts up to 20% of future yield
- `setKeeper(attackerAddress, true)` — adds an attacker bot
- `withdrawVRFReserve(amount)` — drains the reserve (~20 MON per vault)

Right now, you'd only notice these if you happen to look at the contract. A Telegram alert that fires immediately on these events gives you the maximum response window — especially valuable for the entropy-change attack which has a 24h delay before commit.

### Events to alert on

| Event | Why we care | Severity |
|-------|-------------|----------|
| `OwnershipTransferred` | Confirmed handover; should match an expected change | HIGH |
| `EntropyChangeQueued` | Sets a 24h timer; if not authorized, ~24h to react | CRITICAL — go nuclear if unexpected |
| `EntropyChanged` | Confirmed entropy swap | HIGH |
| `EntropyChangeCancelled` | Pending change withdrawn | INFO |
| `FeeUpdated` | New fee or recipient | HIGH (especially if recipient is unexpected) |
| `KeeperSet` | New keeper added or removed | MEDIUM |
| `Paused` / `Unpaused` | Protocol-level pause toggle | HIGH |
| `EmergencyForceSettled` | A round was rescued from a Pyth timeout | INFO (expected operationally) |
| `VRFReserveWithdrawn` | Owner withdrew native MON from a vault | HIGH |
| VRF reserve dropped below 5 MON (computed from balance, not event) | Less than ~6 rounds of VRF runway left | MEDIUM |

### Implementation

This is a builder ticket. Approximate spec:

**Title:** Add governance event alerts to keeper (or new dedicated alert worker)

**Approach:** Extend `scripts/keeper-execute-next.js` (or add a sibling worker `scripts/keeper-alert-watcher.js`) to subscribe to the above events on all configured pool addresses, and forward to the existing Telegram alert path.

**Suggested file:** `scripts/keeper-alert-watcher.js` — separate process, independent of the existing keeper logic, runs in the same Fly app or a new one. Keeps the keeper code focused on transaction signing.

**Approximate lift:** Half a day for a builder familiar with the keeper code. Uses ethers `pool.on('EventName', handler)` pattern for live subscriptions plus an initial scan on boot to catch anything fired while the worker was down.

**Acceptance criteria:**
- Each event in the table above triggers a Telegram message within 30 seconds of being mined
- Message includes: event name, pool address, transaction hash, parameter values, severity tag
- Worker recovers from RPC disconnects without dropping events (re-subscribes on connect)
- A periodic heartbeat ("alert watcher OK, last block scanned: N") fires every 15 min so we know it's alive

Once this lands, **also** add a "test the alert path" item to the monthly ops review: trigger a benign event (e.g., `setKeeper(currentKeeperAddr, true)` is idempotent) and confirm the Telegram arrives. If it doesn't, the watcher is silently broken.

---

## Composite action: write the builder ticket

After this ops plan lands on `staging`, write a single builder ticket combining:

- Action 1 (`flyctl secrets set` for RPC fallback — actually mostly an ops action, not a code change, but verify indexer code supports it)
- Action 4 (governance event alert worker — the actual code change)

Title: `add-resilience-actions-2026-05-28.md`. Tickets are cheap; don't try to consolidate too much.

---

## What this plan does NOT cover

- **shMON failure modes.** Covered separately in ADR-0023.
- **Pyth Entropy failure modes.** Already covered by ADR-0014, ADR-0015, ADR-0021. ADR-0024 (cross-provider randomness abstraction) is the Phase 2 future-proofing item.
- **L1 failure modes.** Not protocol-mitigable in any meaningful way; documented in ADR-0022.
- **Operator legal / regulatory exposure.** Beyond scope of this technical plan.

---

## Tracked follow-up ADRs

After this plan is executed, the following ADRs are queued for writing:

- **ADR-0024:** Cross-provider randomness abstraction (Phase 2 design)
- **ADR-0025:** Monad L1 dependency model (formal companion to ADR-0023)
- **ADR-0026:** Infrastructure dependency model (Fly, Vercel, DNS, GitHub formal trust model)
- **ADR-0027:** Multisig migration record (written when migration happens, not before)

Together with ADRs 0022 and 0023 already written, these form the complete documented trust surface of the protocol.
