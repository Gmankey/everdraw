# ADR-0009 — Frontend per-pool fetch hygiene

**Status:** Accepted
**Date:** 2026-05-08
**Deciders:** User + Claude (PM)

## Context

EverDraw runs multiple concurrent pool contracts (Vault A and Vault B in Phase 1, more vaults likely in later phases). The frontend reads per-pool state (`getRoundInfo`, balances, share rates, participant lists, points context) and re-fetches whenever the user switches between pools or whenever the round transitions.

Two race-condition bugs have shipped to production from this surface:

1. **Vault B "deposit now" card on inactive vault.** The card showed an open deposit window even when Vault B was actually closed because state from the active vault leaked into the inactive one. Fixed in an earlier sprint with a `salesOpen` gate.
2. **Vault A ↔ B rapid tab switching produces `could not coalesce` RPC error and stale card/timer state** (2026-05-08). Caused by multiple in-flight `getRoundInfo` calls stacking up when the user switches tabs faster than the previous fetch settles. Monad's RPC rejects coalesced duplicates, the surviving fetch may be for the previous pool, the UI lags or shows the wrong vault's data.

Both incidents share the same root cause: **the frontend does not enforce an invariant that per-pool reads are safe across rapid view changes.**

## Decision

Every per-pool RPC read in the frontend follows two rules without exception:

### Rule 1: AbortController on view change

Any `useEffect`, `useCallback`, or other lifecycle hook that initiates a per-pool fetch creates an `AbortController` at start and aborts it on cleanup. The fetch passes the controller's `signal`. Errors named `AbortError` are silently swallowed; other errors are reported.

```jsx
useEffect(() => {
  const ac = new AbortController()
  loadPoolState(poolAddress, { signal: ac.signal })
    .catch(err => { if (err.name !== 'AbortError') console.error(err) })
  return () => ac.abort()
}, [poolAddress])
```

This guarantees that switching from Vault A to Vault B aborts any pending Vault A reads before starting Vault B reads. The UI never renders state from a stale fetch.

### Rule 2: Cache must dedupe in-flight Promises

The shared `_cached` helper (or any future replacement) treats an entry whose value is a still-pending Promise as the canonical in-flight request. Concurrent calls to the same key receive the same Promise. A new fetch is started only when the cached entry is settled **and** stale, or absent.

```js
function _cached(key, ttlMs, fetcher, signal) {
  const hit = _rpcCache.get(key)
  if (hit && hit.value && typeof hit.value.then === 'function') return hit.value
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.value)
  const p = fetcher({ signal })
    .then(v => { _rpcCache.set(key, { value: v, ts: Date.now() }); return v })
  _rpcCache.set(key, { value: p, ts: Date.now() })
  return p
}
```

This guarantees that 10 rapid clicks do not produce 10 concurrent identical RPC reads. They produce one read whose result is shared.

### Combined effect

- Switching Vault A → B aborts Vault A reads and starts Vault B reads.
- Switching Vault A → B → A while the first round is still loading rejoins the in-flight Vault A Promise instead of starting a third.
- Monad's coalescing layer never sees duplicates from a single client.

## Rationale

- Cancellation is the only correct fix for "the user no longer cares about this fetch." Without it, fetches outlive their relevance and write into stale state.
- In-flight deduplication is the only correct fix for "two callers want the same thing at the same time." Without it, the network does work that nobody needs and rate limiters punish the client.
- Both rules are cheap, well-known patterns. Adding them everywhere costs little. Failing to add them anywhere costs production incidents.

## Alternatives considered

- **Throttle / debounce tab switches.** Rejected. Hides the symptom rather than fixing the cause. User clicks remain the source of truth. The system has to keep up.
- **Single global `loadAllPools` fetch.** Rejected for Phase 1. Would tightly couple Vault A and Vault B fetch lifecycles. Easier to reason about per-pool isolation.
- **SWR / React Query / TanStack Query.** Right answer long-term. Out of scope for Phase 1 because the existing `_cached` shape is already used everywhere and a library migration is invasive. Revisit when a substantial frontend refactor is on the table anyway.

## Consequences

### Existing code

The two bugs above must be fixed by applying these rules. Builder ticket from the same session covers it:

- Wrap per-pool fetch effects in `AbortController`.
- Update `_cached` to dedupe pending Promises.

### Going forward

Any PR that adds a new per-pool read, a new view that depends on pool state, or a new multi-vault feature (e.g. Vault C in Phase 2, stablecoin vaults in Phase 3) MUST follow these rules. Code review should reject PRs that introduce per-pool reads without an abort signal or that bypass the cache layer.

### Testing

Each new per-pool view should ship with a test that:

- Switches between pools 10× in rapid succession (under 100ms apart).
- Asserts no `could not coalesce` error in the console.
- Asserts the final rendered state matches the final selected pool, not any intermediate one.

### Phase 2 / TWAB

Continuous deposits change the per-pool model substantially (no more discrete rounds), but the abort + dedupe rules still apply to balance and prize-context reads. ADR-0009 stays in force.

## Open questions

None.

## Related

- Builder ticket: `tasks/frontend-per-pool-fetch-hygiene-2026-05-08.md` (to be written alongside this ADR).
- Earlier prevention: ADR-0001 (cadence design assumes the frontend can render two pools in parallel without state leakage).
