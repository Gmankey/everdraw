# V5 Draw Algorithm

**Version:** `everdraw-v5-draw-algorithm/2`

This is the canonical M3 winner-selection algorithm for V5 draws. It is deterministic: given the same on-chain seed, period, account TWABs, prize legs, draw id, and DrawManager address, every implementation must produce the same leaves and merkle root.

## Inputs

- `drawId`: uint256.
- `drawManager`: address.
- `chainId`: uint256.
- `claimManager`: address.
- `seed`: bytes32 from the randomness oracle.
- `accounts`: all candidate participant addresses with their period TWAB, sorted by ascending address after normalization.
- `prizeLegs`: ordered `(token, amount)` list snapshotted and escrowed by `DrawManager`.
- `tierBps`: ordered winner-position splits. Launch is `[10000]`; the algorithm supports more positions.

Sponsor-delegated balances are excluded before this algorithm runs. Accounts with `twab == 0` are excluded. If the filtered total TWAB is zero, no root is proposed.

## Sampling

Build cumulative TWAB over ascending account order. For position `j`, compute:

```text
r_j = uint256(keccak256(abi.encode(seed, drawId, j))) mod totalTwab
```

The winning account is the first cumulative interval containing `r_j`. Sampling is with replacement.

## Amounts

For each prize leg and winner position:

```text
amount = floor(leg.amount * tierBps[j] / 10000)
```

Per-leg floor dust is assigned to position `0`.

## Leaves And Root

`distributionId = keccak256(abi.encode(drawManager, drawId))`.

For every `(position, leg)` payout, in ascending position and configured leg order:

```text
leaf = keccak256(abi.encode(
  LEAF_DOMAIN,
  2,
  chainId,
  claimManager,
  distributionId,
  leafIndex,
  account,
  token,
  amount
))
```

`LEAF_DOMAIN = keccak256("everdraw-v5-claim-leaf/2")`. The chain and ClaimManager binding prevents cross-deployment replay.

Leaves are sorted ascending by hash. The tree is OpenZeppelin-compatible sorted-pair keccak. If a level has an odd leaf count, the final node is promoted unchanged. A single leaf is its own root; no leaves produces `0x00...00`.

## Gate

The Node reference implementation and the independent Python implementation must agree over fuzzed histories and the 100k-account load fixture before M3 can close.
