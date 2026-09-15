# FAQ

**Can I lose my deposit?**

EverDraw separates participant principal from prize yield. Normal withdrawals return principal value as shMON shares, subject to the risks of the shMON strategy and underlying protocol. Prize outcomes do not reduce a participant's recorded principal.

---

**How is the prize funded?**

The main vault and Patron pool hold deposits through shMON. Yield available at draw time funds the prize. Patron deposits contribute yield and earn boosted EverDraw points, but receive zero draw entries and cannot win.

---

**How is the winner selected?**

Each weekly draw uses time-weighted entries derived from balances held during that draw period. More MON held for longer during the period produces more entries. The app shows tickets rather than a win percentage.

---

**Can I deposit or withdraw during a draw?**

Yes. V5 deposits and withdrawals are continuous. A deposit begins building time-weighted entries when it lands; a withdrawal stops future entry accrual on the withdrawn amount. The app warns that withdrawing can affect points streaks and tranche multipliers.

---

**What happens when a draw has no entries or no prize?**

The draw is skipped cleanly. No empty prize is paid, and principal remains withdrawable. Holding a position through a skipped draw can still count for points and streak rules.

---

**What happens when I win?**

The managed keeper submits the finalized prize proof. The ClaimManager automatically compounds the winnings into a fresh tenure-zero main-vault tranche for the winner. My History shows an informational WINNER row and the compounded amount; no browser claim transaction is required.

---

**Is the draw fair?**

The draw is independently verifiable. Pyth Entropy supplies randomness, winner calculation uses the finalized seed and on-chain TWAB data, and an independent watcher recomputes each proposed root during a challenge window. A guardian can veto a mismatched root before finalization. See [Winner Selection](how-it-works/winner-selection.md).

---

**Can a draw pay more than one winner?**

The V5 contracts support one or more winner leaves. The launch configuration determines the winner count and payout allocation for each draw.

---

**Why are there a main vault and a Patron pool?**

The main vault earns draw entries and EverDraw points. The Patron pool contributes its yield to the same opaque prize total and earns boosted EverDraw points, but it has zero chance to win. Both allow continuous deposits and withdrawals.

---

**What do withdrawals return?**

EverDraw sends shMON shares. The convert option performs the same shMON withdrawal and then opens shmonad.xyz, where converting shMON to MON follows shMonad's unstaking process and timing.

---

**Is EverDraw audited?**

EverDraw V5 has undergone internal and external security review and remediation. Current release status and evidence are listed on the [Security](security.md) page. Smart-contract and third-party risk cannot be eliminated.

---

**Can I deposit without the EverDraw UI?**

The contract deposit functions are public. Technical users can interact directly using the verified ABI and the canonical deployment addresses, but they are responsible for selecting the correct active deployment and transaction parameters.

---

**Does shMonad's points program apply to EverDraw deposits?**

EverDraw exposes a Merkl-readable position surface intended for shMonad campaign integration. Any third-party points eligibility, timing, and award rules are controlled by that third party and should not be assumed until its campaign is active.
