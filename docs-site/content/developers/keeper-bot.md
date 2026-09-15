# V5 Keeper

The V5 keeper is a managed Fly service, not a terminal process. It is restartable, state-aware, and independently monitored.

## Lifecycle order

Each loop reconciles on-chain state and prioritizes cheap finalization work before proposing another draw:

1. finalize eligible proposed draws
2. start a due draw
3. wait for the Pyth Entropy seed
4. reconstruct TWAB inputs and compute the root
5. verify JavaScript and Python root parity
6. propose at most one root
7. submit finalized winner proofs to ClaimManager
8. emit success heartbeat and health data

The persistent event cache makes normal work proportional to new blocks rather than vault history.

## Prize settlement

The keeper calls ClaimManager claimMany for finalized leaves. Winner prizes normally compound into fresh tenure-zero main-vault tranches. Terminal proof errors are quarantined once; transient RPC, timeout, nonce, and balance failures remain retryable.

## Monitoring

Launch configuration requires:

- a low-balance floor and warning derived with enough entropy-fee and gas headroom
- Telegram alert delivery
- an external dead-man success URL
- repeated-error thresholds without per-loop alert storms
- persistent cache storage across machine restarts

The independent root watcher is separate from the keeper. A healthy keeper does not prove a proposed root is correct.

## Permissionless liveness

Draw and claim calls remain permissionless under their contract rules. This provides protocol-level recovery if the managed service fails, but the V5 product does not expose a browser winner-claim workflow.
