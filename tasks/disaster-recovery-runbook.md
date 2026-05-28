# Disaster Recovery Runbook

**For:** EverDraw operator (you, or whoever inherits this protocol).  
**Scope:** Your local machine dies, gets stolen, falls in a lake. What you need to bring everything back from scratch on a new computer.

This document assumes the protocol is in the state it was on 2026-05-28: Vault A V3 live, Vault B V3 pending, indexer + keeper + frontend all cloud-hosted.

---

## What does NOT depend on your machine

These all keep running regardless of what happens to you locally:

| Layer | Where | Failure mode |
|-------|-------|--------------|
| Smart contracts | Monad mainnet | Eternal — no failure mode short of L1 outage |
| Frontend | Vercel (`everdraw.xyz`) | Vercel auto-deploys on push to `staging`; running version stays live until next push |
| Indexer | Fly.io (`everdraw-indexer`) | Self-restarting machine; SQLite on a 3 GB volume |
| Keeper | Fly.io (`everdraw-keeper`) | Self-restarting machine; stateless |

If your machine dies right now, **the protocol keeps operating with zero degradation** for users. Only your *ability to make changes* is impaired until you finish recovery.

---

## What DOES depend on your machine (or could)

1. **Private keys** — owner / deployer key, keeper hot key. Both are in your MetaMask seed phrase as long as you have it backed up. The `.env` files on your local disk are convenient but not authoritative.
2. **Authenticated CLI sessions** — `flyctl`, `vercel`. These re-auth in under a minute.
3. **Local dev environment** — node, git, code clone. ~10 minutes to rebuild on a clean Linux box.

---

## Recovery procedure (clean machine → operational in ~30 min)

### 0. Before you have a problem

These three actions, done now, make recovery painless:

1. **Back up your MetaMask seed phrase.** Hardware vault, encrypted password manager, paper in a safe. Without it, the owner key is unrecoverable and the contracts are unmanageable (though they keep running).
2. **Note the wallet addresses** somewhere not on your local machine:
   - Owner / deployer: `0x84875804608467B3577605c0976dC645739091eD`
   - Keeper: `0x80dE4674dEFC68F06F4772B8Ec2F89aBda43DBE9`
3. **Note your account on each cloud provider:**
   - Fly.io: the same account that runs `everdraw-indexer` and `everdraw-keeper` apps
   - Vercel: the same account / team that owns the `everdraw` project (Vercel team slug visible in deploys: `gmans-projects-cfaf4e90`)
   - GitHub: `Gmankey/everdraw` (verify you can still log in and have repo admin)
   - Telegram: the bot owner account for the alert bot (`@everdraw_alerts` or similar)

### 1. New machine setup

Install:
- `git`, `node` (v20+), `npm`
- `flyctl` ([instructions](https://fly.io/docs/hands-on/install-flyctl/))
- `vercel` CLI (`npm i -g vercel` once node is in)
- A code editor

### 2. Clone and orient

```bash
git clone git@github.com:Gmankey/everdraw.git
cd everdraw
cat CLAUDE.md         # reminds you to read decisions/ first
ls decisions/         # full ADR record
ls tasks/             # active and historical tickets
cat deployments/monad-mainnet.json   # exactly what's on-chain
```

If you forgot the wallet addresses or contract addresses, they're all in `deployments/monad-mainnet.json` and in the ADRs.

### 3. Re-authenticate CLIs

```bash
flyctl auth login            # opens browser; sign in to the same Fly account
vercel login                 # same, sign in to the same Vercel account
ssh-add ~/.ssh/id_ed25519    # or whatever your GitHub SSH key is; might re-generate one if needed
gh auth login                # optional, but useful — pick HTTPS + browser flow
```

Verify access:
```bash
flyctl apps list             # should show everdraw-indexer, everdraw-keeper
vercel projects ls           # should show "everdraw"
```

### 4. Restore environment files

The two local env files are not on GitHub (correctly so — they contain private keys). You restore them from your MetaMask:

```bash
mkdir -p ~/.config/everdraw
```

**`~/.config/everdraw/everdraw-root.env`** — deployer / owner config:
```
PRIVATE_KEY=0x<owner private key from MetaMask>
RPC_URL=https://rpc.monad.xyz
MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz
MONAD_MAINNET_CHAIN_ID=143
```

To get the private key from MetaMask: open MetaMask → account menu → Account details → Show private key → enter password → copy. **Paste it into the env file with the `0x` prefix.**

**`~/.config/everdraw/keeper-mainnet.env`** — backup only, only useful if you ever need to run the keeper locally as a fallback. The canonical keeper config lives in Fly secrets. You can either:
- Re-derive the keeper private key from MetaMask (if you imported it as a separate account there), OR
- View Fly secret values (you can't — Fly only shows digests). For visibility you'd need to look at the values you originally set. If you can't remember them, just rotate: call `setKeeper(newKeeper, true)` from the owner wallet to authorize a fresh keeper wallet, then `setKeeper(oldKeeper, false)` to retire the old one. The protocol keeps running on Fly's existing secret set.

### 5. Restart the keeper / indexer (if needed)

These are already running and don't need anything from you. To verify:

```bash
flyctl status -a everdraw-keeper
flyctl status -a everdraw-indexer
flyctl logs -a everdraw-keeper        # check for heartbeats
flyctl logs -a everdraw-indexer       # check lastScannedBlock is current
curl https://everdraw-indexer.fly.dev/api/health
curl -I https://everdraw.xyz          # should return 200
```

If any service is unhealthy: `flyctl machine restart` on that app.

### 6. You are now operational

You can:
- Read ADRs to remember why decisions were made
- Read tickets to see what was pending
- Sign owner transactions from MetaMask (set fee, retire vaults, top up VRF reserves, change Pyth provider with timelock)
- Push code via `staging` branch — Vercel deploys frontend, you `flyctl deploy` to push keeper/indexer code changes
- Onboard a new Claude session: just point it at the repo, it reads CLAUDE.md and decisions/ and is current within 5 minutes

---

## Specific scenarios

### Scenario A: Machine sleeps for a few hours, no key loss

Nothing happens. Fly keeper keeps drawing/settling. Vercel keeps serving. You wake up, everything's fine.

### Scenario B: Machine dies, MetaMask seed backed up

Follow steps 1–5 above. ~30 min from new hardware to full operational capability.

### Scenario C: MetaMask seed lost

This is the unrecoverable case for the **owner** wallet. The contracts keep running but you can never:
- Change protocol fee
- Rotate the keeper
- Change Pyth entropy provider
- Withdraw VRF reserve
- Pause / unpause
- Transfer ownership

Mitigation if it happens: announce loss of admin keys publicly; advise users to withdraw principal from open rounds and not deposit further. Contracts continue to run on the existing config until natural end-of-life. **This is why backing up the seed phrase is the single most important resilience action.**

The **keeper** wallet seed loss is recoverable: from a healthy owner wallet, call `setKeeper(newKeeperAddr, true)` on each vault.

### Scenario D: Fly account locked / compromised

Spin up a fresh Fly account, deploy keeper and indexer from the existing repo + Dockerfiles (`flyctl deploy -c scripts/keeper/fly.toml` and `flyctl deploy -c scripts/indexer/fly.toml`). Reset secrets. ~30 minutes including DNS propagation if you also need to repoint the indexer URL.

### Scenario E: Vercel account locked

Frontend stays live on the current deployment until manually torn down. Spin up a new Vercel project from the same repo, repoint `everdraw.xyz` DNS, redeploy. ~30 minutes plus DNS propagation.

### Scenario F: Monad mainnet outage

You can't do anything from your side. Wait for the chain to recover. The keeper will retry RPC calls (it has backoff). When the chain returns, in-flight rounds resume from where they were.

### Scenario G: Pyth Entropy contract is deprecated

Use ADR-0021's 24h timelock to migrate:
1. From the owner wallet, call `queueEntropyChange(newEntropy, newProvider)` on each V3 vault.
2. Wait 24 hours (gives users a window to withdraw if they don't trust the new provider).
3. Call `commitEntropyChange()` on each vault.
4. New entropy is in effect for all future rounds.

If you have to do this in a panic (Pyth provider has already gone dark): rounds in `AwaitingVRF` state can be unstuck via `emergencyForceSettle()` after the 1-hour VRF timeout. Depositors get principal back; no winner is paid for that round.

---

## Where to find things (the cheat sheet)

| Thing | Location |
|-------|----------|
| Contract addresses + config | `deployments/monad-mainnet.json` |
| ADRs (why each decision exists) | `decisions/` |
| Active and historical tickets | `tasks/` |
| Frontend env (Vercel-authoritative) | Vercel dashboard → `everdraw` project → Settings → Environment Variables |
| Keeper env (Fly-authoritative) | `flyctl secrets list -a everdraw-keeper` |
| Indexer env (Fly-authoritative) | `flyctl secrets list -a everdraw-indexer` |
| Indexer DB | `/data/everdraw.db` inside Fly machine; SSH via `flyctl ssh console -a everdraw-indexer` |
| Keeper logs | `flyctl logs -a everdraw-keeper -f` |
| Indexer logs | `flyctl logs -a everdraw-indexer -f` |
| Live API | `https://everdraw-indexer.fly.dev/api/health` and `/api/rounds`, `/api/wallets/{addr}/rounds` |
| Block explorer | https://explorer.monad.xyz |

---

## What to add to this runbook over time

- New cloud providers / accounts as they get added
- Any new env var introduced
- Any new wallet address authorized for a specific role
- New disaster scenarios as they surface

Keep this file short and dense. Resist the urge to copy operational procedure into it — that lives in the deploy runbooks. This file only answers "I just lost everything — how do I rebuild?"
