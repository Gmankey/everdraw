# Ask to Alex (shMonad) — booster points multiplier campaign

**Date:** 2026-06-27. **Owner:** operator to send (PM drafts; do not send on operator's behalf). **Context:** ADR-0040 Prize Booster door. This is the one open external dependency.

## What we're asking for
A **shMonad points multiplier** for users who deposit shMON into EverDraw's "Prize Booster" door — capped and time-boxed. Not funding, not tokens — just a points multiplier, the same lever shMonad's own degen pool already uses.

## Suggested ask ladder (lead with the pilot)
- **Lead:** capped, time-boxed **parity 10x** shMonad points for the pilot window, framed as an official shMON growth channel.
- **Fallback:** **5x**, uncapped-but-time-boxed.
- Either way EverDraw runs its own boosted EverDraw points in parallel (the stack is the draw).

## Draft message (paste-ready, edit tone to your voice)

> Hey Alex — quick one. We're adding a "Prize Booster" door to EverDraw: users deposit shMON, **keep their principal**, give up their yield to the public prize pool, and take **no win odds**. It's our retail version of your degen pool — give up yield, farm points.
>
> The pitch to shMonad: it locks shMON in a consumer use case (users hold instead of rotating out), grows shMON TVL, and gives shMON a visible "powers the prize pool" story. The boosters are pure shMON stickiness.
>
> The ask is light — a **shMonad points multiplier** for shMON deposited via this door, same mechanism as your degen pool (costs you nothing real). We'd run it as a **capped, time-boxed campaign** — happy to do a 10x parity pilot for a fixed window, or 5x if you'd rather; whatever you'd support as an official channel. We're stacking our own boosted EverDraw points on top, so users double-farm.
>
> Want to scope a pilot window + cap? Can share the boost event spec so your indexer can read it cleanly.

## Notes for the operator
- **Send is your call** (it's an outbound partner message; I draft, you send).
- Keep it a points multiplier — do NOT let it drift into asking shMonad to fund tokens or share revenue (that changes the regulatory posture; see ADR-0040 §3).
- The "boost event spec" we'd share = the distinct Merkl-readable `BoostDeposit`/`BoostWithdraw` stream from the builder ticket, so shMonad's indexer attributes boost-seconds per address.
- Outcome feeds back into ADR-0040 §5 (multiplier value + cap + window).
