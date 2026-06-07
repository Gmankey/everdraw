# Buying Tickets

## What you need

A wallet on Monad mainnet and some MON (or shMON). That's it.

---

## Steps

**1. Open the app.** Go to [everdraw.xyz](https://everdraw.xyz). The current open vault is the landing view.

**2. Connect your wallet.** Click "Connect Wallet" and approve. If your wallet isn't on Monad, EverDraw prompts you to switch. If Monad isn't configured, it prompts to add the network.

**3. Check the vault state.**

- **Green ring**: the vault is open, deposits accepted, with a countdown showing time left in the deposit window.
- **Purple ring**: the vault is locked, yield accruing, with a countdown to the draw.
- **Closed**: the vault is temporarily paused or between rounds; deposits aren't open right now.

**4. Buy.** Enter how many tickets you want. The buy form shows the current price per ticket. Click "Buy Tickets" and sign the transaction. Your MON is staked as shMON the moment the transaction confirms, and your ticket count appears on the stat cards.

You can also pay with shMON if you already hold it — toggle the deposit asset on the buy form.

**5. Wait for the draw.** The round runs itself. When the deposit window and lock both end, the draw runs and the winner(s) are recorded on-chain. Results show up under "Previous Vault" once the round settles.

---

## Things to know

- You can buy multiple times in the same round — your ticket counts add up.
- You can hold positions in more than one vault at once. Each vault is independent.
- Your odds for any prize are your tickets divided by the total tickets in the round.
- Each vault sets its own ticket price; the buy form always shows the live price.
- Buys are blocked in the final seconds before the deposit window closes, to avoid transactions reverting on the boundary.
- You cannot withdraw mid-round. Plan your deposit timing.
