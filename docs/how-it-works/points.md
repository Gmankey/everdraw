# Points

Points are EverDraw's way of recognising loyal participants. They accrue automatically when you take part in a round and grow faster the longer you keep playing.

You can see your balance in the top right of the app, or open your profile page for a full breakdown.

---

## How points are earned

Points are awarded when a round you participated in **settles**, not when you deposit. If you bought tickets and the round settles, you get points. If a round is skipped (no tickets sold) or fails (rare keeper edge case), no points are awarded for that round.

The formula:

```
round_points = (tickets × streak_multiplier) + bonuses
```

- **Tickets:** 1 ticket equals 1 MON equals 1 base point.
- **Streak multiplier:** see below.
- **Bonuses:** additional points for winning, hitting milestones, or playing both vaults in a week.

Example. You bought 5 tickets in a Vault A round, you are on a 6 week streak (×1.10), you did not win and you don't have a deposit in Vault B that week. Round points = `(5 × 1.10) + 0 = 5.5`, rounded.

---

## Streak

Your streak is the number of consecutive weeks you held an active deposit in any vault. Every Wednesday at 13:00 UTC the system checks. If you have at least one open or locked position in either Vault A or Vault B, your streak goes up by 1. If you don't, it resets to 0.

You don't need to deposit in both vaults each week. One is enough. 
---

## Bonuses

These layer on top of the base × multiplier. Below are only some of the bonuses. (There may be other hidden bonuses)

### One-time bonuses

Awarded once per wallet.

- **First deposit:** +25 points the first time you ever buy a ticket.
- **First win:** +100 points the first time you win a round.
- **Streak milestones:** +50 at 4 weeks, and a few more at certain milestones (which you can find out by maintaining your streak). Each one fires the first time you reach that streak length.

### Recurring bonuses

- **Win bonus:** +25 points every round you win.
- **Both vaults:** +10% on the round's points if you have an active deposit in both Vault A and Vault B at the same checkpoint week.
- **Loss streak consolation:** after 10 consecutive non winning rounds, you earn +20% on round points until you next win. Resets when you do.

---

## Tiers

Tiers are visual. They reflect your current streak length and unlock the matching multiplier. You start off in Bronze. Your tier badge is shown next to your points balance.

Tiers do not change your odds. The win odds are strictly your tickets divided by total tickets in the round, the same for everyone.

---

## Where you see points

- **Header.** Top right of the app. Shows your total points and current streak with a flame icon.
- **Deposit preview.** Below the buy button. Estimated points you'll earn for this round.
- **Settlement card.** When a round settles, the previous vault view shows the points you earned for that round.
- **Profile page.** Lifetime balance, current streak with progress bar to the next tier, recent rounds, and bonuses earned.
- **Leaderboard.** Top 100 by lifetime points, with your rank shown if you're outside the top 100.

---

## Things to know

- **Sybil splitting doesn't help.** 5 wallets each with 1 ticket earn the same as 1 wallet with 5 tickets, since base points are linear in your deposit size.
- **Whales don't dominate.** Points multipliers are about consistency not size. Large deposits are already rewarded from base points awards. 
- **shMonad points stack with EverDraw points.** Two separate programs, both running on the same activity. You earn from both at once.
