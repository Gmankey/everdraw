# Buying Tickets

## What you need

A wallet on Monad mainnet and some MON or shMON. That's it.

---

## Steps

**1. Open the app.** Go to [everdraw.xyz](https://everdraw.xyz). The current open vault is the landing view.

**2. Connect your wallet.** Click "Connect Wallet" and approve. If your wallet is not on Monad, EverDraw prompts you to switch. If Monad isn't configured, it prompts to add the network.

**3. Check the vault state.**

- **Green ring**: vault is open, deposits accepted, countdown shows time left in the 24 hour window.
- **Purple ring**: vault is locked, yield accruing, countdown shows time until settlement.

**4. Buy.** Enter how many tickets you want. Each ticket costs 1 MON. Click "Buy Tickets" and sign the transaction. Your MON is staked as shMON the moment the transaction confirms, and your ticket count appears on the stat cards.

You can also pay with shMON if you already hold it. Toggle the deposit asset on the buy form.

**5. Wait for the draw.** The round runs itself. The keeper closes the deposit window after 24 hours and draws a winner six days later. Results show up under "Previous Vault" once the round settles.

---

## Things to know

- You can buy multiple times in the same round. Counts add up.
- You can hold positions in both vaults at once. Each is independent.
- Probability is your tickets divided by total tickets. Ticket price is fixed at 1 MON.
- Buys are blocked in the last 30 seconds before the deposit window closes, to avoid transactions reverting on the boundary.
- You cannot withdraw mid round. Plan your deposit timing.
