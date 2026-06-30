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

## Acceptance
- A user sees a correct, plain-language "your chance in the next draw" with the build-up/steady-state behavior, matching production styling. PM to review against the mechanic above before merge.
