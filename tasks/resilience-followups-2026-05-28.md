# Builder Ticket: Indexer RPC Fallback + Governance Event Alerts

**Target files:**
- `scripts/indexer/src/runner/config.ts` and `scripts/indexer/src/runner/service.ts` (small)
- New: `scripts/keeper-alert-watcher.js` and `scripts/keeper/alert-watcher-fly.toml` (or fold into the existing keeper Fly app — see "Hosting" below)
- New: `tasks/mainnet-ops-runbook.md` Keeper-Alerts section update

**Implements:** Gaps 5 (partial — indexer side) and 6 from `tasks/external-dependency-ops-plan-2026-05-28.md`. References ADR-0022 (trust model) and the working rule in `memory/working_rule_external_dependencies.md`.

**Approximate effort:** Half a day for the indexer fix + governance alerts together. Could be split into two PRs if the builder prefers — they're independent.

---

## Part A: Indexer honors `RPC_URL_FALLBACK`

### Current state

`RPC_URL_FALLBACK=https://monad-mainnet.drpc.org` is set as a Fly secret on `everdraw-indexer` (set 2026-05-28). The indexer code does not read it — `grep RPC_URL_FALLBACK scripts/indexer/src/` returns no matches. The secret is inert until code changes.

### Required change

In `scripts/indexer/src/runner/config.ts`, extend the config to include an optional fallback URL:

```ts
export interface IndexerConfig {
  rpcUrl: string;
  rpcUrlFallback?: string;
  // ... existing fields
}

export function loadConfig(): IndexerConfig {
  const rpcUrl = process.env.RPC_URL ?? '';
  const rpcUrlFallback = process.env.RPC_URL_FALLBACK?.trim() || undefined;
  if (!rpcUrl) throw new Error('Missing RPC_URL');
  // ... existing logic
  return { rpcUrl, rpcUrlFallback, /* ... */ };
}
```

In `scripts/indexer/src/runner/service.ts`, replace the single `JsonRpcProvider` instantiation with a fallback-aware wrapper. ethers v6 has `FallbackProvider` for exactly this case:

```ts
import { FallbackProvider, JsonRpcProvider } from 'ethers';

const primary = new JsonRpcProvider(config.rpcUrl);
const provider = config.rpcUrlFallback
  ? new FallbackProvider([
      { provider: primary, priority: 1, stallTimeout: 2000 },
      { provider: new JsonRpcProvider(config.rpcUrlFallback), priority: 2, stallTimeout: 2000 },
    ], undefined, { quorum: 1 })
  : primary;
```

`FallbackProvider` with `quorum: 1` returns the first successful response. If primary is slow (2s stall timeout) or errors, the fallback takes over transparently.

### Verification

- Build the indexer locally: `cd scripts/indexer && npm run build`
- Deploy to Fly: `flyctl deploy -a everdraw-indexer`
- Watch the boot logs for the first ~30s. The indexer should connect and start scanning normally.
- Optional smoke test: temporarily corrupt `RPC_URL` (set to a bad URL via `flyctl secrets set` with a typo, then revert) and confirm the indexer keeps progressing because the fallback is healthy.

### Out of scope

- Adding a third RPC. Two providers is enough for now (`rpc.monad.xyz` primary, `monad-mainnet.drpc.org` fallback).
- Per-call retry logic. `FallbackProvider` handles this at the provider layer.

---

## Part B: Governance event alerts via Telegram

### Why

If the owner key is compromised, an attacker's first move is likely one of these on-chain admin actions. Right now, the operator has no automated detection — they'd only notice if they happened to look at the contract. Add live Telegram alerts on the governance events that matter most so the operator gets a push notification immediately.

### Events to watch

| Event | Severity | Sample message body |
|---|---|---|
| `OwnershipTransferred(previousOwner, newOwner)` | CRITICAL | `🚨 Ownership transferred on {vault}: {prev} → {new}, tx {hash}. If unexpected, investigate immediately.` |
| `EntropyChangeQueued(newEntropy, newProvider, effectiveAt)` | CRITICAL | `🚨 Entropy change queued on {vault}: entropy={newEntropy}, provider={newProvider}, takes effect at {effectiveAt} (in {hours}h). If unauthorized, call cancelEntropyChange before the deadline.` |
| `EntropyChanged(entropy, entropyProvider)` | HIGH | `Entropy change committed on {vault}: {entropy} / {provider}, tx {hash}.` |
| `EntropyChangeCancelled()` | INFO | `Entropy change cancelled on {vault}, tx {hash}.` |
| `FeeUpdated(feeBps, feeRecipient)` | HIGH | `Fee updated on {vault}: {bps} bps → {recipient}, tx {hash}. Effective next round opened.` |
| `KeeperSet(keeper, allowed)` | MEDIUM | `Keeper {keeper} {allowed ? 'authorized' : 'revoked'} on {vault}, tx {hash}.` |
| `Paused(by)` / `Unpaused(by)` | HIGH | `{vault} {paused/unpaused} by {by}, tx {hash}.` |
| `VRFReserveWithdrawn(to, amount)` | HIGH | `🚨 VRF reserve withdrawn from {vault}: {amount} MON to {to}, tx {hash}.` |
| `EmergencyForceSettled(rid)` | INFO | `Round {rid} emergency-force-settled on {vault}, tx {hash}.` |
| VRF reserve balance below 5 MON (computed, not event-driven) | MEDIUM | `⚠️ VRF reserve on {vault} is {balance} MON (~{rounds} rounds runway).` |

Events `Deposit`, `Withdraw`, `TicketsBought`, `RoundStarted`, etc. are NOT in scope — they fire constantly and would drown the alert signal.

### Implementation: new worker `scripts/keeper-alert-watcher.js`

Architecturally: a separate node process from the keeper, so a bug or hot reload in one cannot take down the other. Same Fly app as the existing keeper (cheaper, simpler) or its own Fly app if isolation is preferred. Recommend **same app, second process group** — Fly supports multi-process apps via the `[processes]` block in `fly.toml`.

#### Approximate structure

```js
// scripts/keeper-alert-watcher.js
import { JsonRpcProvider, FallbackProvider, Contract } from 'ethers';

const POOLS = (process.env.POOL_ADDRESSES || '').split(',').filter(Boolean);
const RPC = process.env.RPC_URL;
const RPC_FALLBACK = process.env.RPC_URL_FALLBACK;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const VRF_LOW_THRESHOLD_MON = Number(process.env.VRF_LOW_THRESHOLD_MON || '5');

const ABI = [
  'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
  'event EntropyChangeQueued(address newEntropy, address newProvider, uint64 effectiveAt)',
  'event EntropyChanged(address entropy, address entropyProvider)',
  'event EntropyChangeCancelled()',
  'event FeeUpdated(uint16 feeBps, address feeRecipient)',
  'event KeeperSet(address indexed keeper, bool allowed)',
  'event Paused(address indexed by)',
  'event Unpaused(address indexed by)',
  'event VRFReserveWithdrawn(address indexed to, uint256 amount)',
  'event EmergencyForceSettled(uint256 indexed roundId)',
];

const provider = makeProvider(RPC, RPC_FALLBACK);

for (const addr of POOLS) {
  const c = new Contract(addr, ABI, provider);
  c.on('OwnershipTransferred', (prev, next, ev) => alert(/* ... */));
  c.on('EntropyChangeQueued', (e, p, t, ev) => alert(/* ... */));
  // ... one .on per event
}

// Periodic VRF reserve check
setInterval(async () => {
  for (const addr of POOLS) {
    const bal = await provider.getBalance(addr);
    const mon = Number(formatEther(bal));
    if (mon < VRF_LOW_THRESHOLD_MON) {
      await alert(`⚠️ VRF reserve low on ${addr}: ${mon.toFixed(2)} MON`);
    }
  }
}, 60 * 60 * 1000); // hourly

// Heartbeat every 15 min
setInterval(() => {
  console.log(`[alert-watcher] heartbeat ${new Date().toISOString()} watching ${POOLS.length} pools`);
}, 15 * 60 * 1000);

async function alert(message) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
  });
}
```

This is sketch-level. Builder fills in: structured alert formatter, error handling for Telegram failures (retry with backoff, don't crash on network error), graceful shutdown, reconnect logic for the WebSocket subscription on transient disconnect, dedup against a small persistent ring of recent tx hashes so a chain reorg doesn't double-fire.

#### Catch-up on boot

When the worker boots after a downtime, it should scan the missed block range so any governance event fired while it was down still triggers an alert:

```js
const lastSeenBlock = readLastSeen(); // from a small SQLite or JSON file on Fly volume
const currentBlock = await provider.getBlockNumber();
if (currentBlock - lastSeenBlock > 0 && currentBlock - lastSeenBlock < 50000) {
  const filter = { fromBlock: lastSeenBlock + 1, toBlock: currentBlock, address: POOLS };
  const logs = await provider.getLogs(filter);
  // process each log via the same alert path
}
writeLastSeen(currentBlock);
```

If the gap is > 50,000 blocks (deeply offline), skip the backfill (logs query would be huge) and send a single "alert watcher restarted after extended downtime, manual review of recent events recommended" message.

This requires **a small persistent state** — a Fly volume of 100 MB is plenty, or write to the same SQLite the indexer uses (read-only access from this worker). Pick whichever is simpler.

#### Hosting

**Option A (recommended): add as a process to `everdraw-keeper`** via `fly.toml`:

```toml
[processes]
  keeper = "node scripts/keeper-watchdog.js"
  alerts = "node scripts/keeper-alert-watcher.js"
```

Then scale: `flyctl scale count keeper=1 alerts=1 -a everdraw-keeper`. Same Dockerfile, same secrets, same VM size. Adds ~$0 (Fly bills per VM and one VM can run multiple processes if memory allows; if not, the alerts process gets its own 256 MB VM at ~$2/mo).

**Option B: separate Fly app `everdraw-alerts`** if the builder wants stricter isolation. Slightly more complex (more Fly config, more secrets management) but cleaner failure boundary.

Recommend Option A.

### Fly secrets to add (operator does this, not builder)

```bash
flyctl secrets set -a everdraw-keeper \
  VRF_LOW_THRESHOLD_MON='5'
```

`POOL_ADDRESSES`, `RPC_URL`, `RPC_URL_FALLBACK`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` are all already set as secrets for the keeper app — the alert worker inherits them.

### Verification

After deploying:

1. Confirm the alerts process is running: `flyctl status -a everdraw-keeper` should show both `keeper` and `alerts` processes.
2. Tail logs: `flyctl logs -a everdraw-keeper`. The alert watcher should log a "watching N pools" line on boot and a heartbeat every 15 minutes.
3. **Manual smoke test** (the operator runs this): from the owner wallet on a testnet vault or a low-stakes mainnet action, call `setKeeper(0xSomeAddr, true)` — a benign idempotent call. A Telegram alert should arrive within 30 seconds. If it doesn't, the watcher is silently broken; investigate before treating this as production-ready.
4. Add a monthly recurring calendar entry: "Test EverDraw governance alert path" — same idempotent action, confirm alert. If three months pass without testing and the watcher has been silent, **assume it's broken** until proven otherwise.

### External dependencies (per working rule)

| Dependency | Used for | Failure mode | Recovery |
|------------|----------|--------------|----------|
| Telegram Bot API | Alert delivery | Telegram API down → alerts not delivered. Worker keeps running and retries with exponential backoff. Heartbeat to console still works for `flyctl logs` observation. | Operator-side: have a secondary alerting channel (email, push notification) when Telegram-confirmed downtime is reported by the operator. Out of scope for this ticket. |
| Monad RPC (primary + fallback) | Event subscription + block reads | Primary down → `FallbackProvider` switches to dRPC. Both down → worker logs error, retries with backoff, no alerts sent during outage. Catch-up scan on next successful connect. | Operator-side: monitor Fly logs for sustained "RPC unreachable" patterns. |
| Pyth Entropy contract | NOT a dependency of this worker — it only reads pool contract events, never talks to Pyth | n/a | n/a |
| Fly.io | Worker hosting | Fly down → worker offline, events missed during downtime. Catch-up scan when Fly recovers. | Operator-side per `tasks/disaster-recovery-runbook.md`. |
| Pool contract addresses | Subscriptions | Bad address → subscription fails on boot, worker exits. Heartbeat absence triggers operator investigation (via `flyctl logs` review). | Verify `POOL_ADDRESSES` matches the canonical manifest before deploying. |

---

## Update `tasks/mainnet-ops-runbook.md`

Add a "Keeper alert watcher" section under the existing Keeper section, listing the new process and the test procedure.

---

## Deliverable

A single PR against `staging` containing:

1. `scripts/indexer/src/runner/config.ts` + `service.ts` — `RPC_URL_FALLBACK` support
2. `scripts/keeper-alert-watcher.js` — new worker
3. `scripts/keeper/fly.toml` — `[processes]` section adding the `alerts` process (or new `alert-watcher-fly.toml` if going with Option B)
4. `scripts/keeper/Dockerfile` — copy the new worker source if needed (depends on what's already in there)
5. `tasks/mainnet-ops-runbook.md` — Keeper alert watcher section
6. Optional: a small `scripts/keeper-alert-state.json` or similar for the catch-up cursor

CI must pass. Indexer FallbackProvider fallback path must be unit-tested if test infrastructure allows; otherwise manually verified via the smoke test above.

PR description must cite this ticket. **Set PR base to `staging`, not `main`.**

---

## Don't

- Don't subscribe to high-volume events (`TicketsBought`, `Deposit`, etc.). They'd drown the signal channel.
- Don't merge the alert watcher with the keeper's main signing logic. Independent processes for independent failure domains.
- Don't add the alert watcher's RPC reads to the existing keeper's RPC budget — the indexer Fly app and keeper Fly app each have their own RPC quota / rate limit. This worker piggybacks on the keeper's quota.
- Don't add SMS or paid alerting paths in this ticket. Telegram is sufficient for now. Email or push notification is a Phase 2 enhancement once volume warrants it.
- Don't ignore the catch-up scan. A watcher that only sees live events misses anything that fires during a deploy or restart, which is exactly when an attacker would prefer to act.

---

## Out of scope (future tickets)

- Frontend banner on `pendingEntropyEffectiveAt > 0` so users see the entropy change in-UI, not just operator-side.
- Public status page (https://status.everdraw.xyz) listing keeper/indexer/alert-watcher health publicly.
- Multi-recipient Telegram (alert one chat normally, escalate to multiple if no ACK in N minutes).
- Phase 2 multisig migration alerts (`SafeMultiSigTransaction` events from the Safe itself).
