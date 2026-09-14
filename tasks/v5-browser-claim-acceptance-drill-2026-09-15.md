# V5 browser-originated claim acceptance drill

Date: 2026-09-15. Implements ADR-0050. UAT only; no contract redeploy. Do not submit another closure audit until the receipt and UI-origin evidence below are saved.

## Builder actions after merge

1. Fetch origin/staging; verify the merged commit and clean tracked source.
2. Deploy from repository root: `/home/c/.fly/bin/flyctl deploy . -a everdraw-keeper-v5 -c scripts/keeper/fly.v5.uat.toml --remote-only --depot=false --yes`.
3. Verify the current DrawManager, ClaimManager, persistent /data volume, healthcheck and normal loop. Do not read signer or alert secrets.
4. Arm: `/home/c/.fly/bin/flyctl secrets set -a everdraw-keeper-v5 V5_UAT_BROWSER_CLAIM_HOLD_MANAGER=0x13f6482864bc0c17B9882a2ef9f3f7448Ede0E90`.
5. Verify normal keeper health. Do not stop the keeper or root watcher. Check whether a hold checkpoint already exists; a prior selected draw must not be silently replaced.

## Operator actions only after builder confirms armed

1. Open https://everdraw-v5-uat.vercel.app and select Monad Testnet (10143).
2. Connect the agreed test wallet. Deposit a small main-vault position using the existing MON/shMON field. Builder records its receipt and confirms participation in the target period.
3. If available yield is below threshold, builder first verifies the current strategy and share token. Operator can donate existing testnet shMON via its normal token Send action to strategy 0x4c026D971942D1715BebAd63B2e6b6Ad54CDDD64; this is a yield donation, not a recoverable deposit. Builder must state the amount and verify its effect before proceeding. Never use mainnet tokens or a mainnet address.
4. Builder observes the next paying draw and its independent watcher verification, then confirms `UAT_BROWSER_CLAIM_HELD` and published verified proof for the winning wallet. No arbitrary wait or repeated manual polling from operator.
5. Connect that winning wallet on UAT. Open My History. Screenshot the claimable WINNER row with the UAT URL visible. Click WINNER to submit the existing claimMany flow, approve the transaction in the wallet, and screenshot the completed UI/wallet confirmation. Send both screenshots and the transaction hash to builder. This is an escrow claim which auto-compounds, not withdrawal of an already compounded tranche.

## Builder completion and rollback

- Save the UI screenshots unchanged, their hashes, transaction status/from/to/calldata, expected leaf identifiers, on-chain claimed flags, PrizeCompounded and same-transaction vault Deposit credit; credited amount can differ from the prize amount.
- Record exact UAT bundle/keeper deployment and UTC timestamps. Verify subsequent profile/position/history refresh; do not substitute a keeper receipt or local test for UI-origin evidence.
- Disarm immediately: `/home/c/.fly/bin/flyctl secrets unset -a everdraw-keeper-v5 V5_UAT_BROWSER_CLAIM_HOLD_MANAGER`. Verify healthy normal keeper loops and no unpaid held prize. Retain checkpoint and evidence; no reset/deletion of points or tranches.
- If operator declines/cannot claim, disarm restores keeper claiming. That does not complete the browser gate.
- Final audit package includes #305 original-fixture retest, its deployed API evidence, accepted dead-man artifacts, and this completed browser drill. No previously waived soak count/duration is reinstated.