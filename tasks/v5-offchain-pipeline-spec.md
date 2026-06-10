# V5 Off-Chain Pipeline Spec

**Implements:** ADR-0036 §4 (winner selection), §3.4–3.5 (draw + claims), B2 ("the off-chain pipeline is half the system"). Feeds build-plan milestone M3.
**Status:** Draft for builder review alongside M0.

The pipeline is four components. Components 1–2 (keeper, watcher) are operationally critical and adversarially related — **they must be implemented independently, by design** (different code, ideally different language/runtime), because the watcher's entire value is catching the keeper's mistakes.

```
 chain events ──▶ [3] Indexer V5 ──▶ frontend API / points
      │
      ├─▶ [1] Draw Keeper: startDraw → compute winners → proposeRoot → (8h) → claimMany
      │
      └─▶ [2] Watcher: independently recompute root → compare → alarm → (operator vetoes)
```

## 1. The canonical winner algorithm (the contract between everything)

Versioned spec, published at `docs-site/pages/developers/draw-algorithm.md` before M3 code starts. The algorithm version is recorded on-chain in each root proposal (`algoVersion` field) so historical draws stay verifiable after upgrades.

**Determinism rules (absolute):**
- Integer math only. No floats, no language-native rounding, anywhere. All TWAB values in wei-seconds (`uint256` semantics); division only where the spec says, always floor.
- All inputs read from chain state/events at a defined block: `seedBlock` = the block in which the VRF seed landed. Nothing after `seedBlock` may influence the output.
- Output must be byte-identical across implementations: same leaf ordering, same tree construction.

**Inputs:** `drawId`; period `[start, end)`; VRF `seed`; the draw's prize legs `(token, amount)[]` from the on-chain draw record; winner config `(count K, tier splits)` from the draw record.

**Step 1 — account set.** Every address with ≥1 `Deposit`/`DepositShmon` event on the V5 vault up to `end`, enumerated and then filtered to `twab > 0` (below). Sponsor addresses are excluded by construction (their TWAB is delegated to zero — the TwabController already reports 0). Canonical ordering: ascending address (byte order).

**Step 2 — per-account TWAB.** `twab(a) = TwabController.getTwabBetween(vault, a, start, end)` evaluated at `seedBlock` state. Implementations MAY reconstruct from events instead of state reads, but the state read is the reference. Units: wei (average balance over the period, floor).

**Step 3 — sampling.** Build the cumulative line `C_i = Σ twab(a_0..a_i)` over the canonical ordering; `T = C_last` (must equal `getTotalTwabBetween` minus delegated-out balances; mismatch = abort, alarm). For position `j` in `0..K-1`: `r_j = uint256(keccak256(abi.encode(seed, drawId, j))) mod T`; winner = the account whose cumulative interval contains `r_j` (binary search). Sampling is with replacement (one account can win multiple positions).

**Step 4 — amounts.** Per position, per prize leg: `amount_{j,leg} = legAmount × tierBps_j / 10000`, floor; the dust remainder of each leg (legAmount − Σ floors) is assigned to position 0. Launch config (Q2): K=1, tierBps=[10000] — the general form still runs.

**Step 5 — leaves and tree.** One leaf per `(position, leg)` aggregated by `(account, token)`: `leaf = keccak256(abi.encode(LEAF_DOMAIN, drawId, account, token, amount))` with a constant domain separator to prevent cross-protocol/tree collisions. Tree: sorted-pair keccak merkle (OpenZeppelin `MerkleProof`-compatible), leaves sorted ascending. Output: `root`, `winnerCount`, `totalPayout` per token (must equal the snapshotted legs exactly — the contract enforces this).

**Edge cases:** `T == 0` → no proposal; the contract's zero-TWAB skip applies. Prize below `minPrizeThreshold` → no proposal; prize rolls (contract-side check; keeper must not propose). Reorg safety: keeper waits for finality on the seed tx before computing (ADR-0036 §7.2).

## 2. Draw Keeper (extends the existing Fly keeper)

Jobs, in order, all idempotent and resumable from on-chain state (keeper restarts must never double-act — every job first reads chain state to decide if it's still needed):

| Job | Trigger | Action | Retry |
|---|---|---|---|
| `startDraw` | `now ≥ periodEnd` | call `startDraw()` | every 10 min until state advances; alarm after 1h |
| `computeAndPropose` | seed finalized on-chain | run algorithm → `proposeRoot(drawId, root, count, payouts)` | recompute from scratch on failure; alarm if not proposed within 2h of seed |
| `executeClaims` | root finalized (8h window elapsed, not vetoed) | `claimMany` in batches (≤200 leaves/tx; gas-profiled at M4) | per-batch retry; deferred leaves are expected behavior, log + continue |

**Key management (post-incident rules apply):** the keeper key signs `startDraw`/`proposeRoot`/`claimMany` only — it can never receive or move prize funds (claims pay leaf accounts, never `msg.sender`). Keep ~2 MON gas float; low-balance alarm at 0.5 MON. The keeper key is NOT the deployer pattern — it is long-lived, lives only in Fly secrets, and is never swept/deleted by script.

## 3. Watcher (independent implementation — the check on the keeper)

- Subscribes to `RootProposed` events. On each: independently recomputes the root **from events only** (deliberately a different data path than the keeper's state reads — this also continuously verifies the indexer's event reconstruction).
- Match → log OK. Mismatch → **Telegram alarm with both roots + diff of winner sets**, repeated every 30 min until the window closes or the root is vetoed.
- The watcher never signs anything. The veto is a **Ledger action by the operator**, per the veto runbook (M8 deliverable): verify the watcher's diff manually, call `vetoRoot(drawId)` on DrawManager via the owner key, confirm the keeper re-proposes correctly.
- Also alarms on: no `startDraw` within 1h of period end; no proposal within 2h of seed; no claim execution within 2h of finalization; `TransferDeferred`-equivalent events firing (venue health signal, carried from V4); proposal by an address other than our keeper (the permissionless path firing means our keeper is down — treat as sev-1 even if the root verifies).
- **8h window staffing reality:** the operator must be reachable within the window. Weekly draws make this tractable — schedule period end (and thus the window) at an operator-waking hour. Launch parameter: period ends Saturday 12:00 UTC (operator can change; recorded at deploy).

## 4. Indexer V5 + points engine

- New event handlers: `Deposit`/`DepositShmon`/`Withdraw`/`SponsorDeposit`, `DrawStarted`/`SeedReceived`/`RootProposed`/`RootVetoed`/`RootFinalized`, `Claimed`/`ClaimDeferred`/`DeferredClaimed`, cap/threshold/config-change events. V4 handlers stay (both generations indexed during coexistence).
- New API surface for the frontend (consumed by the UX redesign, `tasks/v5-ux-redesign.md`): `/api/v5/draws` (per-draw: period, pool TWAB, prize legs, status, winners, rolled?), `/api/v5/position/:addr` (live balance, current-period TWAB so far, projected odds, claimable, deferred), `/api/v5/stats` (TVL series, prize series, depositor count, total paid).
- **Odds math note for the API:** "projected odds" = user TWAB-so-far ÷ pool TWAB-so-far, both over `[periodStart, now]`. Display-only; the draw uses the full period. Must be labeled as live-estimate in the UI.
- Points engine V5: re-mapped rules are specced in the UX doc §5 (they are product decisions, not pipeline mechanics). The engine consumes per-draw TWAB figures this indexer already computes.

## 5. Failure modes (working rule #5)

| Component fails | Effect | Backstop |
|---|---|---|
| Keeper down | Draws stall at whatever step | Everything permissionless after grace (`startDraw` immediately, proposals after 12h); watcher alarms at each stalled step; manual runbook for operator/builder to run each step by hand |
| Watcher down | Bad root could finalize unchallenged | Sev-1: keeper and watcher must not be down simultaneously — independent hosting (keeper on Fly, watcher elsewhere, e.g. a cron on a separate provider); watcher heartbeat alarm (dead-man switch via healthcheck ping) |
| Indexer down | Frontend degraded (stats/position views) | Chain state is the source of truth; deposits/withdrawals/claims unaffected; frontend falls back to direct RPC reads for position basics (as V4 does today) |
| Telegram down | Alarms unseen | Dead-man healthchecks on keeper + watcher through an independent channel (e.g. healthchecks.io email) |
| Fly platform outage | Keeper + indexer both down | Permissionless fallbacks + manual runbook; watcher hosted off-Fly by design (above) |
| RPC provider failure | Any component blind | Two RPC endpoints configured everywhere, automatic failover (carried from V4 ops) |

## 6. Testing gates (feeds M3)

- **Differential:** keeper implementation vs watcher implementation over fuzzed deposit/withdraw histories (10k randomized scenarios) — byte-identical roots required.
- **Load:** 100k accounts, byte-identical roots from both implementations, < 5 min compute.
- **Chaos drills (testnet, M8):** keeper killed mid-sequence at each step; deliberately corrupted root proposed → watcher alarm → operator veto → re-propose; permissionless proposal path exercised end-to-end.
- The reference implementation ships in-repo (`scripts/draw/`) with the spec, so any third party can verify any draw from a fresh clone.
