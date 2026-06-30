# Builder ticket — V5 odds / "your chance" display (TWAB, done correctly)

**Date:** 2026-06-30. **From:** PM. **For:** Builder. **Cites:** ADR-0036 (TWAB). **Why:** the UI shows nothing about a user's win chance; users can't see what TWAB is doing for them.

## IMPORTANT — correct the mental model first (it's NOT "tickets that pile up the longer you stay")
V5 has **no tickets**. Odds are **TWAB** — time-weighted average balance, computed **per draw period**:

> **Your chance in a draw = your average balance over that draw period ÷ everyone's average balance over that period.**

What that means for the UI (and what the operator's "tickets increasing the longer you stay" intuition gets *partly* wrong):
- **Within the current period:** a fresh deposit's weight **ramps up** as it sits — deposit early in the period → near-full weight for that draw; deposit late → small weight for *that* draw only.
- **Across periods:** once you've held through a **full** period, your weight is **full and steady every draw** — it does **not** keep climbing the longer you stay. There is no cumulative loyalty bonus in V5.0. (A "stay longer → permanently higher odds" mechanic would be the Degen Phase-2 idea, not this.)
- **No lock:** deposit/withdraw **anytime**. Withdrawing mid-period lowers your weight for that draw.

So the honest message is **"your full odds kick in once your deposit has been in for a whole draw period,"** not "your odds rise forever."

## What to build (production design language, per the UAT rules)
On the participant vault view, add a **"Your chance in the next draw"** element:
1. **Headline:** estimated `% = yourCurrentTWAB / estimatedTotalTWAB` for the *ongoing* period (clearly an estimate; it finalizes at draw time).
2. **"Building up" state for fresh deposits:** if the user joined mid-period, show their weight ramping toward full (e.g. a fill/ring) with copy: *"Your odds reach full once your deposit has been in for a full draw period."*
3. **Steady state:** once they've held a full period, show full weight with copy that they're entered at full odds every draw, automatically, until they withdraw.
4. **Plain-language explainer** (one line + a tooltip): *"Your chance = your share of all deposits, time-weighted. Bigger deposit and the longer it sits this period = higher chance. Deposit or withdraw anytime."*
5. Reuse the existing prize/stats card styling — **do not invent new components or restyle** (UAT rule). Pull `yourTWAB` / `totalTWAB` from `getTwabBetween` / `getTotalTwabBetween` for the current period, or the keeper/indexer if direct reads are heavy (mind the RPC budget — see launch-readiness §5).

## Do NOT
- Do not show a "tickets" counter or a cumulative "odds keep rising the longer you stay" meter — that's factually wrong for TWAB and will mislead.
- Do not present the draw countdown as a deposit deadline (see the UAT countdown fix).

## LOCKED PARAMETERS (operator, 2026-07-01)
- **Accrual rate: 0.005 tickets per MON per minute** (continuous). `tickets_so_far = 0.005 × (sum of balance × minutes held this draw)`. Equivalent live rate = `balance × 0.005` per minute (e.g. 500 MON → 2.5/min ≈ 0.042/sec).
- **Draw cadence: weekly** (period = 10,080 min). So a steady holder reaches **`balance × 50.4` tickets** by the draw (0.005 × 10,080). 500 MON → ~25,200; 1,000 → ~50,400; 5,000 → ~252,000.
- **Two UI elements:** (1) live **tickets counter** ticking up in real time at `balance × 0.005/min`; (2) a **progress-to-draw bar** — fill = elapsed-time ÷ draw-period, labelled **"X of ~Y by the draw"**, where Y = projected tickets if they hold current balance (`balance × 50.4`). Y **re-targets** when they deposit (rises, accrual steepens) or withdraw (falls).
- Per-draw: tickets **reset/rebuild each draw**, framed positively. **No %, no 1-in-N, no competitor comparison.**
- **Dependency:** the projection assumes the on-chain `drawPeriod` is **1 week**. Testnet used 1h; the mainnet draw cadence must be set to weekly at deploy (ADR-0036 §10-Q1) for these numbers to hold. If the soak/UAT runs a shorter period, scale the display to that period (tickets/draw = `balance × 0.005 × periodMinutes`).

## FINAL UI MODEL — show TICKETS only, NO percentage (operator decision, 2026-06-30)
**Build this. Everything below about a "% to win" is SUPERSEDED — do not display any win-probability % anywhere in the UI.** Show the user only their **tickets** growing.

- **"Your tickets · this draw"** — a prominent counter that **ticks up live** as their MON sits. Tickets accrue at the **rate of their current balance** (tickets = your MON × time it's been in this draw).
- **A line/area** of tickets over the current draw period: it **climbs**, and **kicks steeper the moment they add more MON** (rate = new, larger balance). On withdraw, accrual flattens.
- **No % to win, no "1 in N", no competitor comparison.** Just the user's own tickets — which only they affect, so there's none of the "my % dropped because someone else joined" confusion.
- **Each draw is a fresh start:** tickets reset and rebuild for the next draw — frame this positively ("new draw, your tickets rebuild"), not as a loss. (Implementation: tickets for a draw = the user's TWAB contribution for that period; it's per-draw, not a lifetime pile.)
- Plain copy: "Your tickets grow the longer your MON sits — add more and they pile up faster. More tickets = a bigger shot at the prize."
- Reference mockup (PM, 2026-06-30): "your tickets growing this draw" — live counter + climbing line with a steeper kink after +5.
- Reuse production card/stat styling; no new components (UAT rule); the draw countdown is not a deposit deadline.

> One honest caveat to keep the build truthful: tickets are **per-draw** (they rebuild each draw) and a draw winner is drawn in proportion to tickets — so "more tickets = better shot" is true, but tickets do **not** pile up forever across draws. Don't animate an ever-growing lifetime counter that implies guaranteed/forever-rising odds.

---

## (Superseded background — the underlying mechanic, NOT shown to users)
The sections below describe the TWAB share math and a "% to win" display. **The % is intentionally NOT shown** per the decision above; this is kept only as the mechanic rationale so the builder computes tickets correctly (tickets = the user's time-weighted balance over the draw).

## Visual spec — balance-over-the-draw AREA model (PM-designed, build this)
**(Supersedes the earlier "binary shaded-slice" idea — that can't represent multiple deposits/withdrawals.)** The truth is **time-weighted average balance**: plot the user's **balance over the current draw period (start → draw)** as a step area — it steps **up** at each deposit (only from when it's added) and **down** at each withdraw — and the user's weight is the **average height (the shaded area ÷ the period width)**. That average is what counts; the % is their share of it across all players.

- **The % means (label it explicitly):** "Your chance to win this draw" = **your time-weighted deposit ÷ everyone's time-weighted deposit** — a win probability, not a share of the prize. Show the denominator in plain terms ("your 7.5 ÷ 60 in the pool") and an intuitive **"≈ 1 in N draws"**. Don't show a bare % with no "of what."
- **Headline = projected if they hold** current balance to the draw (`yourTWAB_projected / totalTWAB_projected`). Project — don't tick per-second; only moves when the user or others act. Mark it an estimate (finalizes at draw).
- **The chart (the core element):** y = your balance, x = the draw period. Step up at each deposit, down at each withdraw; shade the area; draw the **average line = "what counts."** This makes every case fall out naturally:
  - **Held all period (one deposit):** flat full rectangle → average = full balance.
  - **Joined mid-period:** zero then a step up → average is the post-join portion only → reduced this draw; full from next draw.
  - **Deposited again later:** a low step then a taller step → average is **between** the two (e.g. 5 then +5 → avg 7.5, NOT 10) → later money counts only from when added.
  - **Withdraw preview:** show the step down to zero at "now" → the average (and the odds) they **keep this draw**; out of future draws. Show BEFORE they confirm.
- **Secondary line:** "ongoing draws: ~Y%" = steady-state share once a steady balance has been held a full period (so a mid-period state isn't mistaken for permanent odds).
- Tooltip: "Your chance = your average balance over the draw ÷ everyone's. Money counts from when you add it and the longer it sits, so deposit early/bigger to raise your average. Withdraw anytime — you keep what you've earned."
- Reuse production card/stat styling; no new component system (UAT rule). Do NOT show a tickets counter or an ever-rising meter; do NOT present the countdown as a deposit deadline.
- Reference mockups (PM, 2026-06-30): held-all / joined-halfway / withdraw-halfway slice cards, and the balance-over-draw step-area chart (5 at start, +5 midweek → avg 7.5 → 12.5%).

### CRITICAL correctness rule — entries climb over time, the % does NOT (don't fake it)
Operator pushback clarified the time axis. Two distinct quantities — keep them distinct in the UI:
- **Entries (climb over time):** your money × time it has sat. This **rises through the draw** and rises **steeper** after you add more — this is the legitimate "time component." Show it as the climbing line/fill; it **resets each draw**.
- **% to win (a share, NOT a clock):** = your entries ÷ everyone's entries. It is **steady while your balance is steady** (everyone's entries tick up together, so your slice doesn't move just because time passes), and it **steps up only when you add more** (or others leave) — e.g. 5 held ≈ 12.5%, add +5 midweek → ≈ 17.6%. A fresh/late deposit's share is reduced for its first partial draw, then full.
- **DO NOT** render a steadily-climbing % for a user who just holds — that is **false** and would mislead users into thinking waiting raises their odds. The climbing visual is **entries**; the % moves only on balance changes.
- Definitive reference mockup (PM, 2026-06-30): "entries climb vs share over draw" — entries line climbs with a steeper kink at +5; % annotated 12.5% → 17.6% (steps at the add, not with time).

### Pool dynamics — the % moves because of OTHER people, so frame it as a live estimate
The % is a **share relative to the whole pool**, so it moves on others' actions too, not just the user's. Build for this:
- **Someone joins mid-draw:** starts a new, lower entries line → smaller share; their joining **dilutes** everyone already in (your % dips when they arrive).
- **Someone leaves mid-draw:** their entries line goes flat → **their** share fades as others keep climbing past them, and **everyone still in gains** (your % rises).
- Therefore your "% to win" is a **live estimate that updates as others deposit/withdraw and locks at the draw** — label it exactly that, so a move the user didn't cause is already explained.
- **Lead with "your entries"** (your money × time in) as the prominent, stable thing the user controls and can watch climb; show the **% to win as the secondary live estimate** with the caveat. Don't make a user feel cheated by a % that dropped because someone else joined.
- Reference mockup (PM, 2026-06-30): "entries join/leave dynamics" — three players each deposit 5; in-all-draw → 50%, joins-midweek → 25%, leaves-midweek → 25%.

## Acceptance (per the FINAL tickets-only model)
- The user sees **"Your tickets · this draw"** as a live-climbing counter + a line that **steepens when they add MON** and flattens on withdraw. **No win-% is shown anywhere.** Tickets are per-draw and rebuild each draw (framed positively). Tickets = the user's time-weighted balance over the draw (computed correctly even though the % isn't displayed). Matches production styling. PM reviews against the tickets mockup before merge.
