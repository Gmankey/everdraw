# Builder Ticket: Frontend per-pool fetch hygiene

**Date:** 2026-05-08
**PM:** Claude
**Spec:** [ADR-0009](../decisions/0009-frontend-per-pool-fetch-hygiene.md). Read first.

## Goal

Eliminate the `could not coalesce` RPC error on rapid Vault A ↔ B tab switches and the stale card/timer state that comes with it. Apply the two rules from ADR-0009 to all per-pool reads in the frontend.

## Scope

All in `web/src/`.

### 1. AbortController on per-pool effects

Audit every `useEffect`, `useCallback`, and other hook that initiates a fetch keyed by `poolAddress`, `mainView`, or any equivalent pool identifier. Add `AbortController` discipline:

- Create `const ac = new AbortController()` at start.
- Pass `ac.signal` into the fetch chain.
- Return `() => ac.abort()` from the cleanup function.
- In the `.catch`, swallow `AbortError`; report everything else.

Concrete starting points (not exhaustive — sweep the file):
- The effect that loads `currentRoundId` and `getRoundInfo` for the active vault.
- The effect that loads previous-round data for the "Previous Vault" view.
- The effect that loads balances and share rates per pool.
- The effect that loads participants for the active round.
- The effect that loads points context (`/api/points/...`) when the wallet or pool changes.

Anywhere a fetch sets React state, that fetch must be cancellable.

### 2. Dedupe pending Promises in `_cached`

Update the existing `_cached` helper so that a still-pending Promise in the cache is the canonical in-flight request. Reference implementation (also in ADR-0009):

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

Existing callers of `_cached` may need their `fetcher` arg updated to accept a `{ signal }` object, or to be wrapped to forward the signal.

### 3. Verification

- Open DevTools console on `everdraw.xyz`.
- Click Vault A, Vault B, Vault A, Vault B, Vault A, Previous Vault, Vault A, Vault B in rapid succession (under 100ms between clicks).
- Expected: no `could not coalesce` errors, no `Cannot read property 'X' of undefined`, no React hydration warnings. Final state matches the final clicked tab.
- Repeat the same pattern in Incognito with throttled network (Slow 3G in DevTools) to stress the abort behavior.

### 4. Tests

Add at minimum one test that simulates rapid tab switching against mocked RPC responses with artificial delay. Assert:
- No more than one in-flight request per `(poolAddress, roundId)` key at any moment.
- The component's final rendered state matches the final selected pool.
- No unhandled Promise rejections.

## Out of scope

- Migrating to SWR / React Query (deferred per ADR-0009).
- Refactoring the entire fetch layer. Surgical fixes only — apply the two rules to existing code.

## Acceptance criteria

1. Manual repro from §3 produces zero RPC errors and zero stale state.
2. Test from §4 passes.
3. Code review confirms every per-pool fetch in `App.jsx` (and any other touched file) uses an abort signal.
4. PM (Claude) signs off after a 5-minute live click-around against `everdraw.xyz` post-deploy.

## ADR reference

[ADR-0009 — Frontend per-pool fetch hygiene](../decisions/0009-frontend-per-pool-fetch-hygiene.md)
