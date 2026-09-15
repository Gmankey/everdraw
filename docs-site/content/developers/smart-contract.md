# V5 Smart Contracts

The current release target is the non-upgradeable V5 stack. Always obtain addresses from the canonical deployment manifest and treat each vault, DrawManager, and ClaimManager tuple as one deployment domain.

## PrizeVaultV5

Main participant entry points:

~~~solidity
deposit() payable
depositShmon(uint256 shares)
withdrawShmon(uint256 principalAmount)
~~~

Patron entry points:

~~~solidity
boostDeposit() payable
boostDepositShmon(uint256 shares)
boostWithdrawShmon(uint256 principalAmount)
~~~

Withdrawals return shMON shares. EverDraw does not synchronously redeem shMON to MON. The frontend's convert choice withdraws shMON and opens shmonad.xyz for the separate unstaking flow.

Participant balances are ERC-20 compatible and transferable at contract level. Sender tenure is consumed LIFO and the recipient receives fresh tenure; the frontend does not promote transfers as a product workflow.

## DrawManagerV5

The lifecycle is startDraw, randomness callback, proposeRoot, challenge or veto, then finalizeRoot. Draw periods are TWAB-grid aligned. Timing and dependency changes follow the contract's queue and commit controls.

The proposed root binds fixed payout leaves to the active ClaimManager distribution. An independent watcher must recompute every proposed root during the challenge window.

## ClaimManagerV5

claim and claimMany verify Merkle leaves and can be submitted by any caller, but funds can only go to the leaf account or its configured compound vault. The managed keeper is the normal caller. Winner shares normally compound into a fresh tenure-zero tranche.

Claim functions are protocol-level liveness primitives. The V5 frontend does not expose a manual winner claim button.

## TwabController and strategy

EverdrawTwabController supplies historical account and total-balance observations for deterministic draw input. ShmonStrategy is the V5.0 strategy and holds real shMON shares. Fork tests against real shMON are part of the release gate.

## Events for integrations

Key events include Deposit, Withdraw, BoostDeposit, BoostWithdraw, participant Transfer, DrawStarted, SeedReceived, RootProposed, RootVetoed, RootFinalized, PrizeCompounded, ClaimPaid, and deferred-claim events.

Use the compiled ABI for exact signatures. Do not infer current behavior from retired V4 interfaces.
