# ADR-0022: Operational Trust Assumptions and Resilience Model

**Status:** Accepted  
**Date:** 2026-05-28  
**Deciders:** Owner

---

## Context

EverDraw's contracts (V2 and V3) are non-upgradeable and immutable once deployed. But the **runtime** around them — the keeper that drives rounds forward, the indexer that surfaces history, the frontend that lets users interact, and the owner wallet that holds admin powers — are operationally centralized.

A user buying a ticket today is implicitly trusting several things beyond the on-chain code. They should be able to read a single document and understand exactly what those trust assumptions are, and what mitigations exist for each.

This ADR documents the protocol's actual trust model as of Vault A V3 launch (2026-05-27) and the runtime resilience choices that back it up.

---

## Decision: explicit trust assumptions

### 1. The owner key controls admin functions

A single owner address (`0x84875804608467B3577605c0976dC645739091eD`) holds the following powers on each V3 vault:

- `setFee(bps, recipient)` — capped at 20% (`MAX_FEE_BPS`); takes effect from the next round opened (ADR-0020 snapshot mechanism)
- `setKeeper(addr, allowed)` — authorize / deauthorize hot wallets for `commitDraw`, `settleRound`, `finalizeDraw`
- `queueEntropyChange()` / `commitEntropyChange()` — change Pyth Entropy contract or provider, subject to 24h timelock (ADR-0021)
- `setNextRoundMetadata(campaign, metadata)` — set per-round metadata for the next round opened (ADR-0021)
- `depositVRFReserve()` / `withdrawVRFReserve()` — manage native MON used to pay Pyth VRF fees
- `pause()` / `unpause()` — block all state-changing operations (deposits, claims, withdrawals, draws)
- `transferOwnership()` — two-step transfer to a new owner

**Mitigations:**
- `MAX_FEE_BPS = 2000` is a hardcoded constant. Owner cannot raise fees above 20%.
- Entropy changes require a 24-hour public delay (`EntropyChangeQueued` event emitted at queue time). Users have a withdrawal window before any swap takes effect.
- Fee changes never affect an already-opened round; players know the fee they're committing to at ticket-buy time.
- Pause blocks deposits and progressions but **does not** block existing withdrawals or claims; users can always exit, even from a paused vault, as long as their round has settled.
- Owner cannot redirect prizes or principal — only fee parameters and the operators who can call privileged functions.

**Recovery if the owner key is lost:**
Contracts continue to run on the existing config. Future rounds open, sales close, draws happen, prizes claim. The only thing that breaks is the ability to make any of the above changes. This is by design — no admin can rugpull, but also no admin can fix.

**Recovery if the owner key is compromised:**
The attacker cannot drain user funds (no admin function does that). They could `pause()` to halt progressions, set fee to 20%, redirect future fees to themselves, withdraw the VRF reserve, change the Pyth provider after 24 hours, or transfer ownership to themselves. Mitigations: announce publicly, encourage user withdrawals before any malicious change takes effect, monitor `OwnershipTransferred` events (ADR-0021 made these standard-shape so block explorers and Defender index them automatically).

### 2. The keeper is permissionless to read but trusted to act

The keeper hot wallet (`0x80dE4674dEFC68F06F4772B8Ec2F89aBda43DBE9`) is authorized via `setKeeper` to call:
- `commitDraw(rid)` — closes ticket sales and triggers a Pyth VRF request
- `_settle` / `settleRound(rid)` — finalizes accounting after VRF callback
- `executeNext()` — convenience wrapper

It pays gas in MON; the protocol must keep it funded. Telegram alerts fire when its balance drops below 0.2 MON.

**Mitigations:**
- The keeper has **no admin powers**. It cannot change fees, pause, swap entropy, or touch the VRF reserve. Only the three round-progression calls above.
- If the keeper goes offline, rounds freeze at whatever lifecycle state they were in. They do **not** drain or corrupt. Owner can recover via `emergencyForceSettle()` after the 1-hour VRF timeout (V3) or by setting a new keeper.
- The keeper is now hosted on Fly.io (`everdraw-keeper` app) for always-on availability, not on the operator's local machine. Single point of failure eliminated.

**Recovery if the keeper key is lost or compromised:**
Owner calls `setKeeper(newAddr, true)` then `setKeeper(oldAddr, false)`. Any funds left on the old keeper wallet are lost (small — kept low intentionally), but the protocol resumes within minutes.

### 3. Pyth Entropy is an external dependency

V3 vaults rely on Pyth Network's Entropy service for verifiable randomness:
- Contract: `0xD458261E832415CFd3BAE5E416FdF3230ce6F134`
- Provider: `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506`
- Fee per request: ~0.77 MON on Monad mainnet

**Mitigations:**
- Each vault holds a self-funded `vrfReserve` (seeded to 20 MON at deploy, ADR-0019). VRF fees come from the reserve, **not** from the prize pool or principal.
- Pyth migration is survivable via the 24h-timelock entropy swap (ADR-0021). The migration is observable in advance via `EntropyChangeQueued` events.
- If Pyth callbacks stop coming, `emergencyForceSettle()` unsticks a round after a 1-hour timeout. Depositors get principal; no winner is paid for that round. Future rounds either retry or skip until the entropy source is fixed.

### 4. The frontend is centralized

`everdraw.xyz` is a single Vercel-hosted React app. If Vercel is down or the domain is hijacked, the contracts keep running but users have no UI.

**Mitigations:**
- All contract addresses and ABIs are in the public GitHub repo and `deployments/monad-mainnet.json`. Anyone can fork the frontend or write their own.
- Block explorer (`explorer.monad.xyz`) provides a fallback path to call `claimPrize` and `withdrawPrincipal` directly.
- Indexer API (`everdraw-indexer.fly.dev`) is public read-only and can be queried independently of the frontend.

### 5. The indexer is the source of truth for historical UI

The frontend reads round history, wallet positions, and round outcomes from `everdraw-indexer.fly.dev`. If the indexer is down or behind, the UI shows stale or missing data — but on-chain reality is unaffected.

**Mitigations:**
- All values displayed by the indexer are reproducible from on-chain logs. The indexer is a cache, not a source.
- The indexer is open-source (in the repo) and self-hostable. A user who doesn't trust the operator's indexer can run their own.
- Frontend's MyRounds and WinnersView paths fall back to direct on-chain reads where possible (e.g., V2's `getUserPosition`, V3's `getRoundInfo`).

### 6. Operator can frontrun their own protocol

The owner could, in principle, deposit into a round, observe the keeper's `commitDraw` tx in the mempool, and time interactions to gain marginal information. This is no different from any oracle-driven lottery on a public chain.

**Mitigations:**
- Winner selection is entirely determined by the Pyth random number, which is committed and revealed asynchronously by the provider. No operator action between `commitDraw` and `finalizeDraw` can influence the outcome (subject to trust in Pyth itself).
- The protocol fee snapshot at round open prevents the owner from raising fees on rounds where they happen to be the winner.

---

## Decision: runtime resilience choices

| Component | Hosting | Failure handling |
|-----------|---------|------------------|
| Contracts | Monad mainnet | Eternal |
| Frontend | Vercel | Auto-deploys from `staging` branch; last good build stays live until next push |
| Indexer | Fly.io (`everdraw-indexer`) | Always-on, auto-restarts; SQLite on 3 GB volume; rebuilt from-scratch via `flyctl deploy` |
| Keeper | Fly.io (`everdraw-keeper`) | Always-on, auto-restarts; stateless; rebuilt from-scratch via `flyctl deploy` |
| Owner key custody | MetaMask seed (operator-side); never on cloud servers | Seed backed up to encrypted offline storage |
| Keeper key custody | MetaMask seed + Fly secret; never in repo | Rotatable via `setKeeper` |
| Disaster recovery procedure | `tasks/disaster-recovery-runbook.md` | Documents new-machine-to-operational in ~30 min |

**Cost of full runtime (Fly.io): ~$6/month** for `everdraw-indexer` (shared-cpu-1x@512MB + 3GB volume) + `everdraw-keeper` (shared-cpu-1x@256MB, no volume).

---

## Rejected alternatives

**Multi-sig owner via Safe.** Rejected for V3 launch. Operationally heavier and slows down emergency response (fee changes, keeper rotation, entropy timelock commits). Worth revisiting in Phase 2 when more users have larger deposits at risk. Tracked as a future ADR.

**Permissionless keeper (anyone can call `commitDraw` / `settleRound`).** Considered. V3 uses `onlyKeeper` because Pyth VRF fees must be paid by the caller, and we don't want random callers paying out of the public reserve in a way that lets them DOS the protocol by spamming requests. Future ADR could revisit if Pyth pricing or interface changes.

**Self-hosted indexer + frontend on operator machine.** Rejected as the protocol matured. Single point of failure that ties protocol availability to one person's laptop. Worth accepting at the experimental phase; not acceptable at mainnet.

**Hardware-wallet-only owner key.** Considered. The current setup uses MetaMask (software wallet) for operational speed during the early ops-heavy phase. Phase 2 should migrate to a hardware-wallet-signed timelock or Safe.

---

## Consequences

- The trust model is explicit and stable. New users can read this document and understand exactly what they're trusting.
- Auditors have a single artefact that documents every admin power and its mitigation.
- New operators (if the role transfers) inherit the same operational topology and constraints without rediscovery.
- Any future privilege escalation (e.g., adding a new owner-only function) requires an ADR amendment to this document explicitly listing the new power and its mitigation.

---

## Open follow-ups

- Phase 2: migrate owner key to Safe multi-sig with at least 2 signers.
- Phase 2: publish a public status page listing keeper / indexer / frontend health and the wallet balances they depend on.
- Add a `pause-with-timelock` mode so even pauses cannot be used as a denial-of-service vector by a compromised owner.
- Document an exit script that users can run locally if the operator goes dark and the frontend disappears: read on-chain state, find their position, sign withdraw / claim transactions via a connected wallet without depending on `everdraw.xyz`.
