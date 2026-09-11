# Points system — handover for audit (2026-09-03)

**From:** PM (acted as builder for these changes, at operator request — the usual builder was occupied).
**Purpose:** audit **intent against result**. Each change below states what I was trying to do, what I actually did, and how to check whether those match. Where they do not match, or where I was wrong, it says so explicitly.

**Please treat my claims as unverified.** I wrote both the code and the tests, so the tests passing only proves the code does what I *believed* it should. The value of this audit is in checking the belief.

---

## 0. Status of the work

| PR | What | State | Commit on staging |
|---|---|---|---|
| #286 | ADR-0049: rebalanced bonuses, Comeback King one-time, qualifying gate, cadence assertion | **MERGED** | `3a31fd7` |
| #288 | UAT points reset evidence + checkpoint interval aligned to 6h | **MERGED** | `e703a2a` |
| #290 | "draw streak" labels, missed milestone values, single source of truth + drift test | **MERGED** | `b8ba770` |
| #289 | Per-draw checkpoint; **deletes** the #286 cadence assertion | **OPEN — not merged** | — |

**#289 supersedes part of #286.** If you audit them in isolation you will find #286 adds a startup assertion that #289 deletes. That is deliberate; §4 explains why.

Also deployed to UAT (not in any PR): points tables wiped and rederived; `POINTS_CHECKPOINT_INTERVAL_SEC` set to 21600 as a Fly secret. Evidence: `tasks/points-data-correction-2026-09-03-uat-reset.md`.

---

## 1. What I found (before changing anything)

Full detail in `tasks/v5-points-pm-audit-2026-09-02.md`. Summary of what drove the changes:

**1a. Two specs exist and contradict each other.** `decisions/0008-points-system-design.md` (marked Accepted) describes the V4 model — account-level streak multiplier, "On the Double" bonus, bonuses of 25–1000 points. `tasks/v5-points-redesign-builder-ticket.md` describes what actually shipped — per-tranche multipliers, bonuses ×1000, On The Double removed. **The code implements the ticket.** So the ×1000 values were deliberate and documented, not drift. I verified this before flagging it.

**1b. Sybil resistance was claimed but absent.** ADR-0008 justifies Sybil resistance on base-points linearity ("splitting wallets gives no advantage"). That held when bonuses were 25–1000 against a comparable base. After the ×1000 rebalance, flat account-level bonuses dominated lifetime totals, and every one multiplies per wallet.

Measured against the shipped code: a **1,000 MON position held for 52 weekly draws earns 4,392,360** base points. The **complete one-off bonus stack was ~4,360,000**, obtainable with dust. A real UAT wallet demonstrated it accidentally: **4,360,171 points from a 2 MON deposit, of which ~171 was base.**

**1c. Comeback King was repeatable at 100,000 points.** Trigger is ≥2 consecutive missed draws. Exit → miss 2 draws → rejoin → repeat is an unbounded loop. `hasReceivedComebackKingBonus` was tracked but never gated on.

**1d. Loss-streak and milestone multi-crossing were inconsistent.** `lossStreakThresholdBonus()` kept only the highest crossed threshold; the milestone loop awarded every crossed one.

**1e. A dead parameter.** `calculateRoundPoints()` accepted `skippedOrFailed` and never read it. It previously gated zeroing; §2b.6 of the ticket changed the behaviour and the parameter was left behind.

**1f. "Weeks" are draws.** Tier ladder, milestones and tranche tenure are all denominated in "weeks" but computed from draw counts. Correct only while one draw ≈ one week.

---

## 2. Change: rebalanced bonuses + Sybil gate (#286, merged)

### Intent

Reduce the one-off stack so farming it is not worth more than genuinely participating, and require a real position to earn one-time bonuses. Operator set the values on 2026-09-02; the 100 MON threshold is also the operator's decision.

Target calibration: the full one-off stack should be worth roughly **one month** of a serious holder, not ten.

### Actual

`scripts/indexer/src/services/pointsMath.ts`:

| Bonus | Was | Now |
|---|---|---|
| Loss Streak 10 / 26 / 52 | 50k / 500k / 2M | **5k / 50k / 200k** |
| Milestone 2 / 4 / 13 / 26 / 52 | 10k/50k/200k/500k/1M | **5k/10k/20k/50k/100k** |
| Comeback King | 100k, **repeatable** | **10k, one-time** |
| First Deposit | 25k | **2.5k** |
| Prize Patron | 25k | **2.5k** |
| Win | 25k | **2.5k** |

Full farmable stack: **4,360,000 → 455,000** (9.6× cut). That is 10.4% of a 1,000 MON year, ≈4.5 draws at full 2× multiplier.

Gate (`derivePoints.ts`): one-time bonuses require entries ≥ a floor derived from 100 MON held through the draw. Applied to First Deposit, Prize Patron, Comeback King and loss-streak awards at settlement, and to streak milestones at checkpoint (via a new `pointsRepo.hasQualifyingPositionAt`). **Win is deliberately exempt** — expected wins scale with share of TWAB, so splitting confers no advantage and gating it would penalise small players for no security benefit. Legacy V4 rows (ticket-denominated, not entries) are never gated.

### What to check

- The gate is expressed in **entries**, not MON: `0.005 × 100 MON × drawPeriodMinutes` (5,040 weekly; 180 at 6-hourly). Is deriving the floor from the period correct, or does it drift from "100 MON" in edge cases (partial-draw holds, multiple tranches)?
- Milestones are gated on `hasQualifyingPositionAt`, which sums `v5_tranches.remaining_amount` — the **current** remaining, not the historical value at that instant. On a replay, a wallet that later withdrew could be denied a milestone it legitimately earned. I judged this acceptable because milestones are awarded forward-only and not replayed, **but I have not proven that.** Worth checking.
- `hasQualifyingPositionAt` sums with BigInt in JS, not SQL, because `remaining_amount` is wei-as-TEXT and SQLite INTEGER is 64-bit (overflows above ~9 MON). Check the overflow reasoning.

### Known limitation, accepted by the operator

A flat bonus behind a threshold is **bounded, not eliminated**. Splitting costs an attacker no capital, so the threshold caps the multiplier at `capital / 100 MON` — roughly **2× total points**, versus ~1000× before. Stake-proportional bonuses would be exactly Sybil-neutral; rejected for V5.0 on simplicity, recorded in ADR-0049 §4 with an explicit trigger to revisit **if points ever acquire value**.

---

## 3. Change: labels, missed values, single source of truth (#290, merged)

### Intent

Three things: (a) milestone labels said "week" while the code counts draws, so rename them; (b) fix values I had missed; (c) remove the duplication that caused the miss.

### Actual

(a) `"2 week streak"` → `"2 draw streak"` through `"52 draw streak"`, plus surrounding copy ("Weekly streak", "weeks active"). `STREAK_MILESTONE_AWARDS` field renamed `week` → `draws`. Loss-streak rows already said "draw"; now consistent.

(b) **A bug I introduced in #286 and did not catch until later.** #286 updated the values in `App.jsx` but missed `web/src/v5PointsView.js`, which carries its own copy of the milestone table. It still held the pre-ADR-0049 values, so the UI advertised milestone awards **10× larger** than the indexer pays. Corrected.

(c) `v5PointsView.js` is now the single frontend source (`BONUS_POINTS`, `LOSS_STREAK_AWARDS`, `STREAK_MILESTONE_AWARDS`); `App.jsx` imports and maps over them instead of twelve inline literals. New `web/src/v5PointsValues.test.js` reads `scripts/indexer/src/services/pointsMath.ts` as text, parses the constants, and fails if the frontend disagrees. It also asserts the one-off stack still totals 455,000, so a repricing cannot silently break the §3 calibration.

### What to check

- The drift test parses TypeScript **with regexes**. If someone reformats `pointsMath.ts` (say, changes the Map literal style), the parse could silently stop finding a constant. I added `assert.ok(match, ...)` on each lookup so it fails loudly rather than passing vacuously — **please confirm that holds for all four parse paths**, including `mapEntries`.
- The values remain mirrored across two packages. The test is the only thing binding them. Is that sufficient, or should the build actually share a file?

---

## 4. Change: per-draw checkpoint (#289, OPEN — audit this most carefully)

### Background: my first attempt was wrong

#286 added a startup assertion that `POINTS_CHECKPOINT_INTERVAL_SEC` equalled the on-chain `drawPeriod`, refusing to start on mismatch. **It caught a real misconfiguration on its first deploy** — UAT had moved to 6-hourly draws while the checkpoint was still hourly. But the operator challenged the design and was right. Three faults:

1. **Blast radius.** The assertion gated the *whole indexer*, so a points misconfiguration also stopped event ingestion, rounds, tranches and claim proofs. Points are recognition-only with no monetary value and must never be able to take that down.
2. **Startup-only.** `validateConfiguration()` latches, so a `drawPeriod` change made through the timelocked tunable *while running* would never be seen — it missed the very scenario that tunable creates.
3. **Multiple deployments deadlock.** `V5_DEPLOYMENTS_JSON` is an array checked against one global interval; two deployments with different periods could never both match, and no config edit could fix it.

### Intent

Remove the mismatch class rather than detect it. Points should move only when draws do.

### Actual

`runWeeklyCheckpoint(checkpointUnix, fromUnix)` replaced by `runDrawCheckpoints()`. Each completed draw advances a wallet's streak by exactly one step: **+1 if they participated in that draw, 0 if they did not.** `POINTS_CHECKPOINT_INTERVAL_SEC`, `isPointsCheckpointDue()` and the assertion are all deleted. Failures are caught in the runner and logged; ingestion continues.

The §3 bonus floor still needs the draw period; it is now read **from the chain** at startup (`readDrawPeriodSec` in `index.ts`) rather than from config. If unreadable the gate is **disabled and logged loudly** rather than blocking startup — points are fully derived, so a later pass rebuilds them.

### Behaviour change you must check

The old checkpoint asked *"do you hold a position right now?"*; the new one asks *"did you participate in this draw?"*.

**Consequence: a wallet that fully exits keeps the streak for the draw it did participate in, and is zeroed at the next draw rather than instantly.** I changed two existing tests that asserted the old behaviour. I believe the new behaviour is correct under draw-tied semantics and that the protective intent survives (the tests now assert the zeroing at the next draw), **but this is the change most likely to be wrong, and it is a user-visible product decision, not just a refactor.** ADR-0049 §2b.1 says a full withdrawal resets the streak "to zero"; under my implementation that is true at the next draw, not immediately. Please judge whether that satisfies the ADR.

### What to check

- `runDrawCheckpoints` is wallet-outer / draw-inner with participants precomputed per draw. Idempotency is per-wallet via `wallet_streaks.lastCheckpointUnix`. Is that cursor sound against partial failure? The one-time award marker is persisted **before** the cursor specifically so a crash cannot double-award — verify that ordering actually gives that property.
- `hadFullExit` uses the window `(previousCursor, drawUnix]`. A wallet that exits and re-enters within one draw is an edge case I have not tested.
- Cost: the loop is wallets × draws in memory, with one participant query per draw. Fine at current scale; check it does not degrade on a long backfill.

### Not fixed by this change

**One draw is one streak step**, so at a 6-hourly cadence a "52 draw streak" is reached in 13 days. The labels are now honest (#290), but the **thresholds** are still calibrated for weekly mainnet draws. Any cadence change remains a points decision. Recorded in ADR-0049 §5.

---

## 5. Where I was wrong (please verify I corrected these properly)

1. **I overstated the "weeks vs draws" finding.** My audit called it a High-severity unenforced invariant. The operator pushed back that draw-aligned accrual is correct and intended. They were right; I downgraded it. The genuine residue was only that one checkpoint window must contain one draw — which #289 removes entirely.
2. **My first fix had the wrong blast radius** (§4). I optimised for "never corrupt points" without asking what else the failure took down.
3. **I updated two of three copies of the bonus values** (§3b), shipping a UI that advertised 10× the real award. The dedupe in #290 is the response.
4. **I claimed Alchemy was misrouting to testnet** during earlier RPC work, based on an assumption about which URL had been curled rather than testing it. It was fine; the exported env var was wrong.

Pattern worth noting for the audit: in each case the *code* did what I told it to, and the tests passed. The failures were in judgement about scope and completeness. Test results are therefore weak evidence here.

---

## 6. Verification I performed (and its limits)

- Indexer: typecheck clean; **21/21 tests pass** on #289's branch (20 on staging).
- Frontend: points-view 3/3, points-values 1/1, prize-wins 2/2, history-result 2/2; eslint clean; `vite build` succeeds.
- **Mutation-tested** the new tests rather than trusting green: disabling the qualifying gate, breaking checkpoint idempotency, advancing +2 per draw instead of +1, and drifting a frontend value each make the relevant suite **fail**. So those suites are not passing vacuously.
- Live UAT check after the reset: wallet `0xa2da3639…` went 1,985,700 → **18,200**, streak 506 → 0. Its base is 109.77/draw (≈61 MON), **below** the 180-entry floor at 6-hourly, and it correctly received **no First Deposit bonus** while still receiving **Win** bonuses. That is the gate behaving as specified on live data.

**Limits:** I wrote the code and the tests. No independent party has checked the *intent*. The UAT sample is one wallet on a small dataset. Nothing here has run on mainnet.

---

## 7. Still open (not addressed by any of this)

- **Formula versioning** (audit L-3). Points formulas are not versioned or frozen. A formula change plus a rebuild silently rewrites historical totals, contradicting ADR-0008's append-only guarantee. Must be frozen before mainnet, where real balances exist.
- **Same-draw tranche merge** (ticket §2b.3) is unimplemented, so there is no bound on tranches per wallet. The cross-tenure "oldest merge" cap was correctly deferred by the previous builder as not points-safe; the *safe* half was dropped with it.
- **ADR-0008 still marked Accepted** while describing a superseded model. ADR-0049 supersedes it for V5, but 0008's own status line has not been changed.
- The UAT Fly secret `POINTS_CHECKPOINT_INTERVAL_SEC=21600` becomes dead once #289 merges and can be removed.

---

## 8. Suggested audit order

1. **§4 behaviour change** — full exit zeroing at the next draw rather than immediately. Highest chance I am wrong, and it is user-visible.
2. **§2 gate correctness** — particularly the entries-vs-MON conversion and the `remaining_amount` replay concern.
3. **§2 Sybil residual** — is a ~2× bounded advantage genuinely acceptable at the agreed values, or does the arithmetic differ from mine?
4. **§3 drift test robustness** — does it actually fail on every drift path, including a reformat of `pointsMath.ts`?
5. **§5** — confirm each acknowledged error is actually corrected in the merged code, not just described here.
