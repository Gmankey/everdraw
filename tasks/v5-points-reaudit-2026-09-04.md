# Points re-audit — findings for builder (2026-09-04)

**Audited:** `origin/staging` after #292–#295. **By:** PM.
**Scope:** fresh pass over the points system, not a re-check of my own earlier findings.

Three defects and one design question. None risk funds; #1 and #2 are operability and scale. Everything I claim below I traced in the code — evidence is included so you can disagree with the reasoning rather than take my word.

---

## First: your changes are better than what I had

Recording this because the audit should say what held up, not only what didn't.

- **`v5MinPrincipalWei`** is the right fix. My gate read `v5_tranches.remaining_amount`, which is the *current* remaining, so on a replay a wallet that later withdrew could be denied a bonus it legitimately earned. I flagged that as unproven in my handover. Recording the historical minimum principal held for the complete draw, transaction-atomically, removes the problem instead of tolerating it.
- I traced the minimum-principal algorithm in `deriveV5Tranches.ts` (~line 496–535) and it is correct: `windows` is sorted by `periodStart` (line 416) and windows within a deployment are consecutive and non-overlapping, so the single monotonic `cursor` is sound; the minimum is seeded from the balance at `periodStart` and re-checked after each transaction group, which correctly captures a piecewise-constant balance; a wallet depositing mid-draw gets `0`, which is right for "held for the entire draw".
- **Formula versioning (#294)** closes the open L-3 from my audit.
- **Full exit now resets the streak immediately** — `applyFullExitBoundary` zeroing `currentStreakWeeks`, plus `resetCurrentStreaksAfterFullV5Exits()` at the end of the replay against a `lastCheckpointUnix` that now tracks the latest draw. That closes a gap I could not close in #289 and satisfies ADR-0049 §2b.1 better than my version did.
- Making the replay canonical and transactional is a better answer than my incremental per-draw checkpoint. **Please close #289** — merging it now would conflict and regress this.

Verified: 22/22 indexer tests pass; my `v5PointsValues.test.js` drift guard survived the `pointsMath.ts` restructure, and I mutation-tested it against the new file (changed `FIRST_DEPOSIT_POINTS` to 9_999 → it failed with "First Deposit drifted from the indexer") so it is not passing vacuously.

---

## 1. MEDIUM — a points failure makes every sync report failure, forever, and it is invisible

**Evidence.** `runner/service.ts`:

```ts
function rebuildDerivedState(): void {
  deriveRoundsService.rebuildFromRaw();
  deriveWalletRoundsService.rebuildFromRaw();
  deriveV5TranchesService?.rebuildFromRaw();
  deriveWalletStatsService.rebuild();
  derivePointsService?.rebuildSettlementPoints();   // no try/catch
}
```

`rebuildSettlementPoints()` begins with `pointsRepo.assertFormulaCompatible(...)`, which throws on either branch — historical rows carrying a different `formula_version`, or a registered fingerprint that differs. `rebuildDerivedState()` is called unguarded inside `syncOnce()`, and `start()` catches, logs `[indexer] sync failed`, and retries every `pollIntervalMs`.

**Consequence.** Raw ingestion still commits (`commitCanonicalRange` runs per chunk, before the rebuild) and the first four derived services still run, so the blast radius is narrower than a crash. But:

- the indexer logs a sync failure **every poll cycle, indefinitely**, which buries any genuine ingestion failure in the same log line;
- `[indexer] sync ok` never prints again, so anything keying on sync success is permanently red;
- points silently stop updating while `/api/health` keeps reporting an advancing `lastScannedBlock` — it looks healthy.

The *intent* of `assertFormulaCompatible` is right: refusing to silently rewrite historical awards is exactly what ADR-0008's append-only rule needs. The problem is only the failure mode.

**Fix.** Wrap the points rebuild so it fails alone:

```ts
try {
  derivePointsService?.rebuildSettlementPoints();
} catch (error) {
  console.error('[indexer][points] rebuild failed; ingestion continues and points will'
    + ' rebuild once resolved:', error);
}
```

Points are recognition-only with no monetary value, and they are fully derived, so a later pass recovers them. They must not be able to make the rest of the indexer look broken. Please also make the failure distinguishable in logs/alerting from a real sync failure — a permanently-red sync signal that everyone learns to ignore is worse than no signal.

*(This is the same mistake I made with the cadence assertion in #286, which is why I recognised it.)*

## 2. MEDIUM — the full replay runs every poll cycle even when nothing changed

**Evidence.** `syncOnce()`:

```ts
if (toBlock >= finalizedHead - 500) {
  rebuildDerivedState();
}
```

No check on `inserted`. Once caught up this fires every cycle — default `INDEXER_POLL_INTERVAL_MS` is 2000 — regardless of whether any event arrived.

`rebuildSettlementPoints` is O(draws × wallets), and there are ~7 repo calls per participant per draw (`ensureWallet`, `getWalletPoints`, `getWalletStreak`, `hadV5VaultFullExitBetween`, `hasDegenDepositAtOrBefore`, `insertRoundPoints`, `upsertWalletPoints`, `upsertWalletStreak`), plus the non-participant loop over `knownWallets` for every draw.

**Rough scale.** 52 weekly draws × 250 wallets ≈ 13,000 iterations ≈ **91,000 queries every 2 seconds**. Both factors grow monotonically — draws accumulate forever and wallets accumulate with adoption — so this only ever gets worse. Fine on UAT today; I do not think it holds at mainnet scale a year in.

Note this is partly pre-existing (the replay was always full), but #293 moved streak and milestone work *into* it, so per-iteration cost went up and it is now the only mechanism.

**Fix.** Cheapest is to skip when there is nothing to do — no new events since the last rebuild, or no new completed draw since the last replay. A stored "last replayed draw" marker would let you short-circuit in one query. Full incremental derivation is a bigger change and probably not warranted yet.

## 3. LOW — dead code, and it is the *wrong* implementation

`pointsRepo.hasQualifyingPositionAt` (interface line 27, implementation line 283) has **no callers**. It was mine, from #286, superseded by `v5MinPrincipalWei`.

Worth deleting rather than leaving: it implements the qualifying gate the old way, summing *current* `remaining_amount`. Anyone who wires it up later — the name reads exactly like what you'd reach for — silently reintroduces the historical-accuracy bug your change fixed. Dead code that looks like a security control is a trap.

`minQualifyingEntries` was removed cleanly; nothing to do there.

## 4. DESIGN QUESTION — the gate counts vault and Patron principal combined

`deriveV5Tranches.ts` merges both pools before computing the minimum:

```ts
// ADR-0049 section 3: eligibility is based on the minimum combined principal
```

So 50 MON vault + 50 MON Patron clears the 100 MON bar for one-time bonuses.

That is defensible — it is real capital at risk, and gating Prize Patron (a Patron-pool bonus) on vault-only principal would be odd. But it is not what the documents say. ADR-0049 §3 says "a qualifying position of ≥ 100 MON" without qualifying which pool, and the redesign ticket §2b.4 says vault and degen tranches are separate sets.

No code change needed if combined is intended — but it should be stated explicitly in ADR-0049 §3 so a future reader doesn't "fix" it to vault-only and quietly change who earns bonuses.

---

## Suggested order

1 and 3 are small and independent. 2 needs a little thought about where to put the marker. 4 is a one-line ADR amendment plus the operator's confirmation.
