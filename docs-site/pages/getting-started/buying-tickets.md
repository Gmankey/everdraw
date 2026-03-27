# Buying Tickets

## Prerequisites

- A wallet compatible with Monad (MetaMask, Rabby, or any EVM wallet)
- MON on Monad mainnet
- That's it

---

## Step by step

**1. Go to the EverDraw app**

Navigate to [everdraw.xyz](https://everdraw.xyz). You'll land on the current open vault.

**2. Connect your wallet**

Click "Connect Wallet" in the top right. Approve the connection in your wallet.

If your wallet is not on Monad mainnet, EverDraw will automatically prompt you to switch networks. Approve the switch — or if Monad isn't in your wallet yet, approve the "Add Network" prompt that follows. You do not need to configure anything manually.

**3. Check the vault status**

The vault graphic shows the current state:
- **Vault open — accepting deposits** — tickets are available, countdown shows time remaining
- **Vault locked — accumulating yield** — deposit window has closed, yield is building
- **Winner revealed — settling soon** — draw is complete, unstaking in progress
- **Settled — claim available** — funds are ready to claim or withdraw

The countdown timer shows exactly how much time remains in the current stage.

**4. Enter your ticket count and buy**

Enter how many tickets you want to purchase in the input field. Each ticket costs 1 MON. Click "Buy Tickets" and confirm the transaction in your wallet.

Your MON is immediately staked via ShMON on confirmation. The stat cards update to show your ticket count and deposit.

**5. Wait for the draw**

That's all you need to do. The round runs automatically. The draw executes when the sales window closes and the keeper processes the committed block. You'll find the results in the Previous Vault tab once the round's winner is revealed.

---

## Things to know

**You can buy multiple times in the same round.** Your ticket counts accumulate. Two purchases of 5 tickets each is the same as one purchase of 10 tickets.

**You can buy tickets in multiple rounds simultaneously.** Each round tracks your position independently.

**Ticket count determines probability, not deposit size in a vacuum.** If you buy 10 tickets and the total round tickets are 100, your probability is 10% regardless of the MON value. Ticket price is fixed at 1 MON.

**You cannot withdraw during an open round.** Your principal is committed until the round settles. Plan accordingly.
