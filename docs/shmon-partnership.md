# The shMON Partnership

shMON is Monad's largest liquid staking token, issued by the shMonad protocol. EverDraw's relationship with shMON is a design partnership. The two protocols are built to strengthen each other.

---

## What shMON is

When you stake MON via shMonad you receive shMON, a liquid token representing your staked position. shMON earns Monad's consensus layer yield while remaining usable across DeFi.

The yield is structural. It does not come from a lending market, a token emission, or another protocol's fees. It exists for as long as Monad has staking.

---

## How EverDraw uses shMON

When you deposit into EverDraw, your MON is staked as shMON immediately and held inside the vault as shMON shares. Yield accrues passively for the 6 day lock as the shMON share rate moves. The total yield accumulated across all positions in a round is the prize.

There is no internal unstaking step. The vault holds shMON the whole time, settles in shMON, and pays winners and depositors in shMON. If you want raw MON, you unstake outside EverDraw on shmonad.xyz, which goes through Monad's epoch unstaking queue. Most users keep their position in shMON and re-enter the next round directly.

You can also deposit using shMON you already hold. Both deposit paths land at the same internal accounting.

---

## Why shMON

**The right yield source for prize savings.** Lending market yields compress and expand with DeFi cycles. When rates fall, prize sizes get uninspiring and the flywheel reverses. shMON is consensus layer yield. It is independent of borrowing demand and liquidity depth, and it provides a floor that exists as long as Monad runs.

**Chain alignment, not yield extraction.** Other yield sources skim fees from DeFi activity. EverDraw deposits stake MON and contribute to Monad's validator security directly. Every depositor is simultaneously playing prize savings and strengthening the network. This is the structural reason EverDraw is on Monad and nowhere else.

**A design partnership, not a generic integration.** EverDraw works directly with the shMonad team. As shMonad evolves staking mechanics or epoch parameters, EverDraw evolves with them. Deeper than an ERC 4626 wrapper.

---

## Points: shMonad's program applies to EverDraw deposits

EverDraw's contract exposes a Merkl readable position surface. `Deposit` and `Withdraw` events fire on every ticket purchase and every principal withdrawal. `balanceOf(user)` and `totalSupply()` follow standard read semantics. The position is non transferable.

This is the same surface shMonad uses for its existing points integrations. Merkl indexes EverDraw events alongside the rest of the shMON ecosystem and time weights balances off chain. shMonad points accrue automatically for active EverDraw depositors. No separate sign up.

EverDraw's own points program runs alongside this. Both stack.

---

## Why this benefits shMON

**Protocol driven staking volume.** Every EverDraw deposit is a shMON staking event. As EverDraw TVL grows, shMonad's staked MON grows with it. Organic, protocol driven demand without shMonad running its own user acquisition.

**A new user segment.** shMonad's current base is DeFi native. EverDraw brings casual holders, lottery curious users, and DeFi newcomers who would never seek out a staking protocol but happily deposit into a no loss prize pool. They become shMonad stakers without thinking about it.

**Ecosystem narrative.** EverDraw's "every deposit strengthens Monad" story benefits shMonad directly. The protocols grow each other's visibility.

---

## The bigger picture

shMON is the foundation of EverDraw's yield architecture. EverDraw is designed to expand to additional asset types and yield sources over time. shMON remains the native yield floor that ensures the core product always works regardless of broader market conditions.
