# Points

EverDraw points recognise participation and consistency. They do not have a stated cash or token value, and they do not change your odds of winning a draw.

You can see your balance in the app header and open your profile page for a full breakdown.

---

## How points are earned

V5 base points come from the entries that actually draw:

```
base_points = 0.005 x balance in MON x minutes held in the draw period
```

A steady 500 MON balance over a full weekly draw earns about 25,200 base entries before multipliers. If you join halfway through a draw, you earn only the post-deposit slice for that draw, then full-period entries from the next draw if you keep holding.

Skipped or dust draws can still count for participation and streak logic when you held a position. The important distinction is whether you were present, not whether the prize was large.

---

## Tranche-based multipliers

Multipliers attach to each deposit tranche, not your whole wallet. Fresh money starts at the base rung, even if you have older deposits with higher tenure. This prevents someone from keeping a tiny old deposit and applying its multiplier to a large new deposit.

Withdrawals consume the newest tranche first:

- **Partial withdrawal:** removes the newest portion and its tenure; older remaining tranches keep their tenure.
- **Full withdrawal:** closes that pool position and resets that pool's streak/multiplier path.

Vault and Patron pool tranches are independent.

---

## Vault streak tiers

Vault deposits follow the weekly streak curve:

| Weekly streak | Tier | Multiplier |
|---|---|---|
| 0-3 | Bronze | 1.00x |
| 4-7 | Silver | 1.10x |
| 8-12 | Gold | 1.25x |
| 13-25 | Platinum | 1.50x |
| 26+ | Diamond | 2.00x |

The app may show an effective blended multiplier when you have several tranches at different tenure levels. Your tier badge is separate from win odds.

---

## Patron pool points

Patron pool deposits earn boosted EverDraw points but receive zero draw entries and no chance to win. The Patron multiplier ramps by consecutive weekly participation in that pool:

| Patron weeks | Patron multiplier |
|---|---|
| 1 | 2x |
| 2 | 3x |
| 3 | 4x |
| 4+ | 5x |

Patron points use the Patron ramp, not the vault streak multiplier.

---

## Bonuses

Bonuses are added on top of base points and multipliers.

- **First Deposit:** +25,000 once per wallet.
- **Win:** +25,000 when you win a draw.
- **Comeback King:** +100,000 when you rejoin after missing two or more consecutive draws.
- **Prize Patron:** +25,000 on your first Patron pool deposit.
- **Loss Streak:** bonuses at 10, 26, and 52 consecutive non-winning draws.
- **Streak Milestones:** bonuses at selected weekly streak milestones.

There is no On The Double bonus in V5.

---

## Where you see points

- **Header:** total points, streak, and tier summary.
- **Profile page:** lifetime points, bonuses, recent draws, your entry, and next multiplier progress.
- **Patron pool:** boosted points source and ramp progress.

---

## Things to know

- Splitting one position across several wallets does not create extra base points; base points are linear in balance over time.
- Large deposits earn more base entries, but the multiplier is earned by each tranche's own tenure.
- shMonad may run its own points program separately from EverDraw points.
