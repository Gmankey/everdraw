# V5 UX Redesign — Stats, Profile/Points, My Rounds, Draw States

**Implements:** ADR-0036 (TWAB model) on the frontend. Data contract: `tasks/v5-offchain-pipeline-spec.md` §4 (indexer API).
**Status:** Draft. Per operator: stats, user profile, and My Rounds are the priority redesigns; main-page visual styling/copy the operator iterates personally.
**Scope note:** this is the design spec; implementation goes through builder tickets citing ADR-0036 + this doc. No `web/` edits by the PM.

## 1. The mental-model shift the whole UI must teach

V4 UI answers: *"when can I buy, when does my round close, did my round win?"*
V5 UI answers: *"how much is in, how long has it been in, what's this week's prize, when's the next draw?"*

Everything below follows from four facts: deposits are always open; your odds = your average balance this week ÷ everyone's; you stay entered every week automatically; one weekly draw covers the whole pool (no per-user rounds, no vault A/B).

**Vocabulary (used consistently everywhere, including points copy):** "Draw #N" (was Round), "this week's prize", "your average balance" (the user-facing word for TWAB — never say TWAB in UI), "win chance". Retired words: round, ticket, sales window, vault A/B.

## 2. Draw lifecycle states (replaces round states; drives the "previous round" surface)

The current-draw widget and Previous Draw view both render from one state machine:

| State | When | UI |
|---|---|---|
| **Accruing** | all week | Prize so far (live, growing), countdown to draw, "Deposits always open" |
| **Drawing** | period end → seed (minutes) | "Drawing winner…" moment — the random number is being generated on-chain |
| **Verifying** | root proposed → +8h | "Winner drawn — verifying results. Paid by ~{time}." Honest, boring, confidence-building: one line explaining anyone can verify the result, linking to the verify-it-yourself docs page |
| **Paid** | claims executed | Winner reveal: address/ENS, prize, "paid automatically" badge, explorer link |
| **Rolled** | prize < threshold | Positive framing, never apologetic: "Prize rolled over! Next week's prize starts at {amount}" |

Key honesty rule (ADR-0036 §4.4 / risk register): the Verifying state is a *feature of the UI*, not something to hide. Winners are paid ~8–12h after period end; the UI must never imply instant payout.
**Previous Draw button** → renders the last completed draw in this same widget (Paid or Rolled state), with a "see all draws → Stats" link. With one pool and one weekly cadence there is exactly one previous draw — no vault selector.

## 3. My Rounds → **"My Position"** (priority redesign)

V4's My Rounds is a ledger of discrete entries (one row per round entered, locked/claimable/winnings per row). Under TWAB there are no entries — there is one living position plus a history of weekly outcomes. Two-panel page:

### 3a. Position panel (top — the V4 stat cards re-mapped)

| V4 card | V5 card | Source |
|---|---|---|
| Locked MON | **Deposited** (withdraw any time — no lock copy ever) | live balance |
| Claimable | **Claimable** (deferred payouts + anything unclaimed; ~always 0 since prizes auto-pay; banner if >0, carried from V4 pending-claims UX) | `/api/v5/position` |
| Winnings | **Total won** (lifetime, all draws) | indexer |
| Games played | **Weeks in** (consecutive weeks with a balance — feeds streak, §5) | indexer |

Plus the two new numbers that ARE the product, displayed most prominently:
- **"Your average this week: X MON"** with a live **win chance** ("≈1 in 230 · 0.43%") — labeled *live estimate* (odds finalize at the draw; pipeline-spec odds-math note).
- A one-line explainer under it the first time: "Your chance = your average balance this week ÷ everyone's. The longer your deposit sits, the higher your average."
- Primary actions: Deposit / Withdraw, both always enabled (the single biggest visible difference from V4 — no windows, no disabled states).

### 3b. History panel (bottom — one row per draw, auto-generated)

Every draw the user had a nonzero average in, newest first:
`Draw #N · your avg X MON · win chance Y% · WON Z MON ✦ / no win · points earned`
No claim buttons in history (auto-paid); a row only grows a Retry button if its payout deferred. Migration-era rows: V4 rounds render beneath a "V4 history" divider, read-only, with their old claim flows intact until V4 retirement.

## 4. Stats page (priority redesign)

Same skeleton as today (hero, overview cards, chart, table) — re-based from rounds to draws + the continuous pool:

**Overview cards:** Pool size (TVL, live — the headline number; V4 has no equivalent because deposits reset every round) · This week's prize so far (live) · Total prizes paid · Draws completed · Unique winners · Depositors (current count).
**Charts:** (1) **TVL over time** (line — the growth story; new), (2) **Prize per draw** (bar — direct successor of today's yield-per-round chart; rolled draws render as hollow bars stacking into the next paid one).
**Draw history table:** `# · Week ending · Status (Paid/Rolled) · Pool avg · Prize · Winner` — winner links to explorer as today. Tickets column is gone (no tickets); pool average replaces deposited-this-round. V4 round history moves behind a "V4 archive" tab during coexistence, dropped after retirement.
**Verification footer (new, small):** "Every draw is verifiable — run it yourself" → docs. The §4.4 trust posture made into a feature.

## 5. Profile / points re-mapping (priority redesign)

The mechanic survives almost intact — it's already weekly — but every input must be re-based from tickets/rounds to TWAB/draws. Rules below are the **product spec for the indexer points engine V5**; UI layout (pill, tiers, streak dots, bonus list) carries over visually.

| V4 rule | V5 rule | Rationale |
|---|---|---|
| Base points = tickets bought that round | **Base = floor(your average balance that week, in MON)** | Same magnitude (1 ticket ≈ 1 MON ≈ 1 point); rewards size × time, not purchase events; sybil-resistant by construction (splitting wallets doesn't change total TWAB) |
| Streak = consecutive weeks you bought in | **Streak = consecutive weeks with average ≥ 1 MON** | THE BIG CHANGE: staying deposited continues the streak automatically — no weekly re-buy ritual. Retention-aligned: the streak now measures exactly what the protocol wants (money staying in). Threshold ≥1 MON so dust can't farm streaks |
| Multiplier ×1.0→×2.0 by streak (4/8/13/26 wk) | Unchanged | Already week-based |
| Tiers Bronze→Diamond | Unchanged | Already streak-based |
| Streak milestones (2/4/13/26/52 wk: +10/+50/+200/+500/+1000) | Unchanged | — |
| Win bonus +25, Comeback King +100 | Unchanged (per draw won) | — |
| Loss-streak bonuses (10/26/52 non-win weeks: +50/+200/+500) | Unchanged (consecutive eligible-but-no-win weeks) | Much more relevant in V5: everyone is in every draw |
| First Deposit +25 | Unchanged | — |
| **On the Double +50 (entered both vaults)** | **Retired at V5 launch** (one pool — nothing to double); no replacement bonus (operator decision 2026-06-10 — no Mover/migration bonus). Already-earned On-the-Double points are kept (history is history). Re-introduce a two-pool bonus if/when a second V5 pool exists | — |
| Points awarded at round settle | **Awarded at draw finalization** (root finalized — not proposal, so a vetoed root never mints points) | Integrity under §4.4 |

**Continuity — DECIDED (operator, 2026-06-10): points, streaks, and earned bonuses carry over across the migration.** A user who migrates within a 4-week grace window keeps their streak unbroken (indexer-side; the points DB is ours to honor).

**Profile page additions:** current average balance + live win chance mirrored from My Position; streak dots now also show *projected* continuation ("stay deposited to keep your streak" instead of "come back Friday").

## 6. Main page + migration (operator iterates visuals; functional requirements only)

- Hero = this week's prize (live-growing) + countdown to draw + Deposit. No sales-window machinery anywhere: no open/closed badges, no vault A/B selector, no "next window" countdowns — delete, don't hide.
- Deposit modal: MON and shMON tabs (both V4.1 paths carry over); cap-reached state ("Vault at capacity — cap raises as the protocol matures", per Q6 deposit cap) with a notify-me hook; min-deposit error stays generic (tunable).
- Withdraw: always-on, shows accrued odds kept this week ("withdrawing now keeps your chances earned so far this week" — §3's exit semantics, true and reassuring).
- **Move-to-V5 flow (launch banner, two transactions):** Step 1 `withdrawPrincipal` on V4 (returns shMON) → Step 2 approve+`depositShmon` on V5; progress UI handles wallet rejection mid-flow (resume from step 2); streak carry-over shown as the reason to migrate within the grace window. V4 pages stay reachable read-only until retirement.
- Deferred-claims banner: carried from V4 unchanged (rare path, already designed).

## 7. Operator decisions (resolved 2026-06-10)

1. **Points continuity across migration: YES** — streaks/points/bonuses carry over (§5).
2. **No migration ("Mover") bonus** — On-the-Double is retired with no replacement; streak carry-over is the migration incentive.
3. **Draw moment:** Saturday 12:00 UTC accepted in principle; exact time finalized before M8 testnet soak (must keep the 8h verify window in operator waking hours — pipeline spec §3).
4. **Stats keeps a combined V4+V5 all-time "total prizes paid" figure: YES** (headline continuity).
