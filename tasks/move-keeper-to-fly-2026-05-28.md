# Builder Ticket: Move Mainnet Keeper to Fly.io

**Target:** New Fly app `everdraw-keeper`  
**Files touched:** `scripts/keeper/Dockerfile`, `scripts/keeper/fly.toml`, optional `.dockerignore`  
**Deploys to:** Fly.io (paid plan, same account as `everdraw-indexer`)  
**Deadline:** None hard, but ideally before any extended period away from the operator's machine. V3 Vault A's first real round opens Wed 2026-06-03 13:00 UTC — keeper must be up by then.

---

## Goal

The keeper (`scripts/keeper-watchdog.js` + `keeper-execute-next.js`) currently runs as a bare node process on the operator's local WSL. If that machine sleeps, the network drops, or the box dies, **no V3 round can be committed, drawn, or settled** until the keeper is manually restarted. This is the only single point of failure left in the protocol's runtime — all other services (frontend on Vercel, indexer on Fly, contracts on Monad) are already cloud-hosted.

Move the keeper to its own Fly app so it runs always-on, auto-restarts on crash, and survives any local machine event.

Approximate cost: **~$2/month** for a `shared-cpu-1x@256MB` machine with no volume.

---

## Scope

**In scope:**
1. New Fly app `everdraw-keeper` with `Dockerfile` + `fly.toml` co-located in `scripts/keeper/`.
2. Set Fly secrets matching the current `/home/c/.config/everdraw/keeper-mainnet.env`.
3. Deploy. Verify keeper picks up V3 round 1 status correctly (no spurious commit/settle attempts).
4. **Cutover** — stop the local keeper, confirm Fly keeper is the only one running, verify by Telegram heartbeat.
5. Update `tasks/mainnet-ops-runbook.md` with the new ops surface (`flyctl` commands, log streaming, secret rotation).

**Out of scope:**
- No code changes to `keeper-watchdog.js` or `keeper-execute-next.js` themselves. They already work; we're just changing where they run.
- No new ADR — this is a runtime-topology change, not a design decision. The keeper's role/authority is unchanged. Document in the ops runbook instead.
- No volume / persistent state — the keeper is stateless. Crash, restart, fine.
- No HTTP/health-check endpoint on the keeper. Fly's process supervision is sufficient (auto-restart on crash). If the operator later wants a `/healthz` endpoint they can add it as a follow-up.
- Indexer is untouched. Different Fly app, different lifecycle.

---

## Implementation

### File: `scripts/keeper/Dockerfile`

Mirror the indexer's Dockerfile structure. Note: the keeper imports from `../keeper-watchdog.js` / `../keeper-execute-next.js`, so the Docker build context must include `scripts/` not just `scripts/keeper/`.

```dockerfile
FROM node:20-slim

WORKDIR /app

# Install build deps for any native modules in the keeper's dep tree
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package manifests first for layer caching
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy keeper sources (relative to repo root; build context must be repo root)
COPY scripts/keeper-watchdog.js ./scripts/
COPY scripts/keeper-execute-next.js ./scripts/
COPY scripts/keeper-health.sh ./scripts/
COPY scripts/keeper-env-check.sh ./scripts/
COPY abi/ ./abi/

# Default command: the watchdog supervises the executor
CMD ["node", "scripts/keeper-watchdog.js"]
```

Notes:
- `npm ci --omit=dev` keeps the image lean.
- `--ignore-scripts` skips any postinstall scripts that aren't needed in production.
- We copy ABIs because `keeper-execute-next.js` reads from `abi/TicketPrizePoolShmonV2.json` and `abi/TicketPrizePoolShmonV3.json`. Verify this is correct by grepping the keeper for ABI imports before deploying.

### File: `scripts/keeper/fly.toml`

```toml
app = "everdraw-keeper"
primary_region = "sjc"

[build]
  # Build context is repo root, Dockerfile is inside scripts/keeper/
  dockerfile = "scripts/keeper/Dockerfile"

[env]
  NODE_ENV = "production"
  # Non-secret keeper config (secrets are set via `flyctl secrets`)
  KEEPER_INTERVAL_MS = "30000"
  KEEPER_DRY_RUN = "false"
  KEEPER_LOW_BALANCE_MON = "0.2"
  KEEPER_ERROR_ALERT_THRESHOLD = "3"
  KEEPER_BALANCE_LOG_EVERY_TICKS = "5"
  KEEPER_HEARTBEAT_LOG_EVERY_TICKS = "10"
  KEEPER_PREFLIGHT = "true"
  TELEGRAM_TIMEOUT_MS = "8000"
  TELEGRAM_RETRIES = "2"

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"

# No [[services]] block — the keeper is a pure background worker.
# No volumes — keeper is stateless.

[deploy]
  strategy = "immediate"
```

### `.dockerignore` (create or update at repo root)

Avoid sending the entire repo into the Docker build context:

```
node_modules
web
docs
docs-site
src
test
lib
out
cache
forge-out
.git
.github
.vscode
.fleet
.openzeppelin
deployments
tasks
decisions
*.md
.env
.env.*
```

`abi/` and `scripts/` must NOT be ignored — keeper needs both.

### Fly secrets to set

These come straight from `/home/c/.config/everdraw/keeper-mainnet.env`. The operator must supply the actual values; the builder should not see or commit them.

```bash
flyctl secrets set -a everdraw-keeper \
  PRIVATE_KEY='<keeper hot wallet, 64 hex chars no 0x prefix>' \
  RPC_URL='https://rpc.monad.xyz' \
  RPC_URL_FALLBACK='' \
  POOL_ADDRESSES='0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888,0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d,0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee' \
  POOL_ADDRESSES_V2='0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888,0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d' \
  POOL_ADDRESSES_V3='0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee' \
  POOL_SCHEDULE_V2='0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d:Sun:1' \
  POOL_SCHEDULE_V3='0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee:Wed:13' \
  TELEGRAM_BOT_TOKEN='<from current env file>' \
  TELEGRAM_CHAT_ID='5759377461'
```

Notes:
- Pool address lists are deliberately frozen to today's mainnet state. If a vault is retired or a new one deploys, both the local env file (if you still maintain it as a backup) and Fly secrets must be updated.
- `KEEPER_DRY_RUN=false` makes this a real-keeper deployment. **First run should be in dry-run.** See cutover sequence below.

### Optional: `package.json` script for convenience

Add to root `package.json` `scripts`:
```json
"keeper:deploy": "flyctl deploy -c scripts/keeper/fly.toml",
"keeper:logs": "flyctl logs -a everdraw-keeper",
"keeper:status": "flyctl status -a everdraw-keeper",
"keeper:restart": "flyctl machine restart -a everdraw-keeper"
```

These are nice-to-have. If they conflict with existing names, skip.

---

## Cutover sequence

**Critical — must be done in this exact order. The risk to avoid: two keepers running in parallel, both signing commit/settle with the same wallet, causing nonce collisions and wasted gas.**

1. **Create the Fly app** (`flyctl apps create everdraw-keeper`).
2. **Set all secrets** as listed above.
3. **First deploy in dry-run mode** — temporarily override `KEEPER_DRY_RUN=true` in the deploy or as a separate secret. The keeper boots, reads pool state, would normally call `commitDraw`/`settle` but skips the actual transactions.
4. **Tail Fly logs** for ~10 minutes (`flyctl logs -a everdraw-keeper`). Confirm:
   - It connects to Monad RPC
   - It reads `currentRoundId` from all three pool addresses (V2 A, V2 B, V3 A)
   - It does NOT report any errors decoding round info (ABI mismatch)
   - The Telegram heartbeat fires
5. **Stop the local keeper** on the operator's WSL before flipping Fly to live mode:
   ```bash
   pkill -f keeper-watchdog.js
   pkill -f keeper-execute-next.js
   ```
   Verify with `ps -ef | grep keeper` — must be zero matches.
6. **Flip Fly keeper to live**: unset the dry-run override, restart the machine. From this moment on, Fly is the only signer.
7. **Verify the next scheduled action runs from Fly** — wait for the next 30s polling tick. Should see in Fly logs either "no action" (if no round is ready) or an actual on-chain tx. Cross-check with Monad block explorer that the tx was sent by `0x80dE...DBE9`.
8. **Permanently disable the local keeper** so it doesn't accidentally restart on reboot. If running under systemd (it isn't currently, but verify): `systemctl --user disable everdraw-keeper`. If running via shell-rc or login script: comment that out.

### What if it goes wrong mid-cutover

If Fly keeper misbehaves before step 8:
- `flyctl scale count 0 -a everdraw-keeper` immediately stops the Fly keeper.
- Restart the local keeper manually: `cd ~/.openclaw/workspace/everdraw-clean && set -a && . /home/c/.config/everdraw/keeper-mainnet.env && set +a && nohup node scripts/keeper-watchdog.js > /tmp/keeper-watchdog.log 2>&1 &`
- File a bug for the Fly issue, retry the move later.

---

## Verification checklist

After cutover, all of these must be true:

- [ ] `flyctl status -a everdraw-keeper` shows the machine `started` and `1/1 passing`
- [ ] `flyctl logs -a everdraw-keeper` shows recent heartbeat lines, no panics
- [ ] `ps -ef | grep keeper` on the operator's machine returns nothing
- [ ] Telegram heartbeat alert was received from the new Fly keeper (the alert payload should reference its wallet address `0x80dE...DBE9` and the pool addresses it watches)
- [ ] V3 Vault A round 1 still shows `state=Open` on-chain (Fly keeper should NOT have prematurely committed/settled it — sales don't end until Thu 13:29 UTC)
- [ ] V2 Vault B (Sun anchor) shows the expected state for its current round
- [ ] On the next legitimate scheduled action (the soonest will be the V3 Wed:13 anchor, or any V2 Vault B Sun:01 action), the tx is signed by `0x80dE...DBE9` and visible on Monad explorer

If any check fails, run the rollback in the previous section.

---

## Operations after migration

Replace the operator's mental model from "node process on my laptop" to these Fly commands:

| Action | Command |
|--------|---------|
| View logs | `flyctl logs -a everdraw-keeper` |
| Tail logs (live) | `flyctl logs -a everdraw-keeper -f` |
| Check machine status | `flyctl status -a everdraw-keeper` |
| Restart (picks up secret changes) | `flyctl machine restart -a everdraw-keeper` |
| Update a pool address / schedule | `flyctl secrets set -a everdraw-keeper POOL_ADDRESSES='...'` (auto-restarts) |
| SSH in for debugging | `flyctl ssh console -a everdraw-keeper` |
| Stop temporarily | `flyctl scale count 0 -a everdraw-keeper` |
| Resume | `flyctl scale count 1 -a everdraw-keeper` |
| Redeploy after code change | `flyctl deploy -c scripts/keeper/fly.toml` |
| Rotate keeper hot key | `flyctl secrets set -a everdraw-keeper PRIVATE_KEY='...'` then call `setKeeper(newAddr, true)` from the owner wallet on each vault, then `setKeeper(oldAddr, false)` to retire the old one |

Add a short "Keeper ops" section to `tasks/mainnet-ops-runbook.md` with these commands as part of this PR.

---

## Update `tasks/mainnet-ops-runbook.md`

Add a section near the top:

```markdown
## Keeper

Lives on Fly.io as `everdraw-keeper`. Source: `scripts/keeper-watchdog.js` (supervisor) + `scripts/keeper-execute-next.js` (worker). Config: `scripts/keeper/fly.toml`.

Keeper hot wallet: `0x80dE4674dEFC68F06F4772B8Ec2F89aBda43DBE9` — authorized on all V3 vaults via `setKeeper`. Top up periodically; alert fires below 0.2 MON.

[then the command table above]

If the keeper is stopped for >30 min during an active VRF window on V3, the owner can call `emergencyForceSettle` after the 1-hour VRF timeout to recover.
```

---

## Deliverable

A single PR against `staging`:

1. `scripts/keeper/Dockerfile`
2. `scripts/keeper/fly.toml`
3. Updated `.dockerignore` (or new file at repo root if missing)
4. Updated `tasks/mainnet-ops-runbook.md` with the Keeper section
5. Optional `package.json` keeper:* scripts

PR description should include:
- Cutover plan summary (or link to this ticket)
- Confirmation that the operator has set Fly secrets manually before the merge (so the deploy actually has them available)
- Telegram alert proof that the new Fly keeper booted and heartbeat'd

Do not commit any secrets to the repo. The `flyctl secrets set` command is run manually by the operator and never logged into git.

---

## Don't

- **Don't** keep the local keeper running after the cutover. Two keepers = nonce wars = wasted gas and stuck rounds.
- **Don't** add a volume / persistent storage. The keeper has no state worth persisting — anything it needs is on-chain or in env vars.
- **Don't** scale to multiple machines. Multiple keeper instances would race for the same on-chain action. Single-instance always.
- **Don't** move RPC_URL into `[env]` block of fly.toml. Keep it in secrets even though it's not strictly private — keeps the rotation surface uniform.
- **Don't** delete `/home/c/.config/everdraw/keeper-mainnet.env` on the operator's machine after cutover. Keep it as a documented backup config (now redundant with Fly secrets, but useful for emergency local restart if Fly itself fails). Mark it as such with a comment at the top of the file.
- **Don't** modify `keeper-watchdog.js` or `keeper-execute-next.js` source in this PR. Just package and host them differently. Source changes are separate tickets.
