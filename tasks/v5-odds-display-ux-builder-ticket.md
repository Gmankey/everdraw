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

## Visual spec — draw-period timeline (PM-designed, build this)
Make time-weighting legible by drawing the **draw period as a horizontal timeline (start → draw)** and **shading the slice of it the user's balance is counted for**. That shaded slice *is* their chance. This is the required presentation.

- **Headline:** "Your chance · this draw" = projected final share **if they hold their current balance to the draw** (`yourTWAB_projected / totalTWAB_projected`). Project, don't tick per-second — it should only move when the user or others act. Show it's an estimate.
- **Timeline bar:** track = the current draw period; shade (accent) the portion their balance counts; leave the rest muted; mark "now".
  - **Held all period:** full bar → full % (steady state). Copy: entered at full odds every draw until withdraw.
  - **Joined mid-period:** only the post-join slice shaded → reduced % "this draw"; copy: full odds (~steady %) from the next draw.
  - **Withdraw preview:** when the user opens withdraw, show the slice they'd keep (start → now) and the % they **keep this draw**, with copy "you keep the odds you've earned; out of future draws." Show this BEFORE they confirm.
- **Secondary line:** "ongoing draws: ~Y%" = steady-state share once held a full period, so the mid-join case isn't mistaken for their permanent odds.
- One-line explainer + tooltip: "The shaded slice is the part of this draw your balance counts — that's your chance. Deposit early to fill more; withdraw anytime and keep what you've earned."
- Reuse production card/stat styling; no new component system (UAT rule).
- Reference mockups: held-all / joined-halfway / withdraw-halfway timeline cards (shared by PM 2026-06-30).

## Acceptance
- A user sees a correct, plain-language "your chance" built on the **draw-period timeline / shaded-slice** model above, with correct behavior for: held-full (full+steady), joined-mid (reduced this draw, full next), and withdraw-mid (keep earned slice, out of future). Matches production styling. PM reviews against the mechanic + the mockups before merge.
