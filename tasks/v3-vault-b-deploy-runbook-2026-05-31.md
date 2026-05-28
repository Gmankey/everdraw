# Runbook: Vault B V3 Mainnet Deploy

**When:** Sun 2026-05-31 01:00 UTC  
**What:** Deploy `TicketPrizePoolShmonV3` as the new Vault B, replacing V2 Vault B (`0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d`).  
**ADRs:** ADR-0010 (cadence), ADR-0019 (V3 migration), ADR-0020 (protocol fee), ADR-0021 (pre-deploy hardening).

This runbook locks in the lessons learned from the Vault A V3 deploy on 2026-05-27. Do not deviate from the order. Each step's gotcha is noted inline because we hit it.

---

## Pre-flight (do up to 24 hours before)

### 1. Verify deployer wallet has enough MON

The deployer/owner wallet `0x84875804608467B3577605c0976dC645739091eD` needs:

- ~0.05 MON for the deploy tx
- 20 MON for `depositVRFReserve()`
- ~0.01 MON for `setKeeper`
- Safety margin

**Minimum: 21 MON.** Top up at least an hour beforehand so the tx is confirmed.

Check live balance:
```bash
set -a && . /home/c/.config/everdraw/everdraw-root.env && set +a
node -e "
const { JsonRpcProvider, Wallet, formatEther } = require('ethers');
const w = new Wallet(process.env.PRIVATE_KEY);
const p = new JsonRpcProvider(process.env.MONAD_MAINNET_RPC_URL);
p.getBalance(w.address).then(b => console.log(formatEther(b), 'MON'));
"
```

### 2. Verify deploy env is set in root env file

`/home/c/.config/everdraw/everdraw-root.env` should already contain:
```
PRIVATE_KEY=0x...                   # owner / deployer hot key
MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz
MONAD_MAINNET_CHAIN_ID=143
```

If anything's missing, fix before continuing.

### 3. Confirm staging is clean and ahead of `main`

```bash
cd /home/c/.openclaw/workspace/everdraw-clean
git checkout staging
git pull --rebase origin staging
git status --short | grep -v '^??'   # must be empty
```

### 4. Confirm Pyth Entropy addresses haven't moved

ADR-0019 pinned:
- Entropy: `0xD458261E832415CFd3BAE5E416FdF3230ce6F134`
- Provider: `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506`

If either has been rotated (check Pyth docs / status page), DO NOT proceed — file an ADR amendment first.

---

## Deploy (00:55 UTC start window)

### 5. Stash untracked files out of the working tree

Preflight refuses to deploy if `git status --porcelain` has any output, including untracked. Workaround:

```bash
mkdir -p /tmp/everdraw-untracked-stash
for f in .claude/settings.local.json AGENTS.md AUDIT_REPORT_V2.md \
         BUILDER_TICKET_VRF_INTEGRATION.md script/DeployTicketPrizePoolShmonV3.s.sol \
         scripts/keeper-event-monitor.js web/AGENTS.md \
         'security_audit/AUDIT_REPORT_2026-04-08_v1-era.md:Zone.Identifier'; do
  [ -e "$f" ] && mv "$f" "/tmp/everdraw-untracked-stash/$(basename "$f")"
done
git status --short   # must be truly empty now
```

If any new untracked files have appeared since the Vault A deploy, add them to that list.

### 6. Run the deploy

```bash
cd /home/c/.openclaw/workspace/everdraw-clean
set -a && . /home/c/.config/everdraw/everdraw-root.env && set +a
export SHMON=0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c
export ENTROPY=0xD458261E832415CFd3BAE5E416FdF3230ce6F134
export ENTROPY_PROVIDER=0x52DeaA1c84233F7bb8C8A45baeDE41091c616506
export OWNER=0x84875804608467B3577605c0976dC645739091eD
npm run deploy:mainnet:v3
```

The script runs preflight + Hardhat compile + ABI check + manifest check + deploy. Takes 60–90 seconds. **Record the printed contract address.** It looks like:

```
TicketPrizePoolShmonV3 deployed: 0x<NEW_VAULT_B_ADDRESS>
```

If the deploy fails partway: review the error, fix, re-run. The script is idempotent before the on-chain step.

### 7. Seed VRF reserve + authorize keeper

Same wallet, same env. Replace `<NEW_VAULT_B_ADDRESS>` with the address printed in step 6.

```bash
node -e "
const { Wallet, JsonRpcProvider, Contract, parseEther, formatEther } = require('ethers');
const VAULT_B_V3 = '<NEW_VAULT_B_ADDRESS>';
const KEEPER = '0x80dE4674dEFC68F06F4772B8Ec2F89aBda43DBE9';
const ABI = [
  'function VERSION() view returns (string)',
  'function depositVRFReserve() payable',
  'function setKeeper(address keeper, bool allowed)',
];
(async () => {
  const p = new JsonRpcProvider(process.env.MONAD_MAINNET_RPC_URL);
  const w = new Wallet(process.env.PRIVATE_KEY, p);
  const pool = new Contract(VAULT_B_V3, ABI, w);

  console.log('VERSION:', await pool.VERSION());

  console.log('Seeding 20 MON VRF reserve...');
  const tx1 = await pool.depositVRFReserve({ value: parseEther('20') });
  console.log(' tx:', tx1.hash);
  await tx1.wait();

  console.log('Authorizing keeper', KEEPER);
  const tx2 = await pool.setKeeper(KEEPER, true);
  console.log(' tx:', tx2.hash);
  await tx2.wait();

  const reserveBal = await p.getBalance(VAULT_B_V3);
  console.log('VRF reserve:', formatEther(reserveBal), 'MON');
})();
"
```

Expected output: `VERSION: 3.0.0`, reserve = 20 MON.

### 8. Capture runtime bytecode hash

```bash
node -e "
const { JsonRpcProvider } = require('ethers');
const crypto = require('crypto');
const p = new JsonRpcProvider('https://rpc.monad.xyz');
p.getCode('<NEW_VAULT_B_ADDRESS>').then(code => {
  const bytes = Buffer.from(code.slice(2), 'hex');
  console.log(crypto.createHash('sha256').update(bytes).digest('hex'));
});
"
```

Record the hash for the manifest.

---

## Coordinated config updates (these are where Vault A bit us — do not skip any)

### 9. Update Vercel env (frontend) — must use `vercel env add`, not local `.env`

**This is the gotcha that made Vault A invisible for ~20 minutes.** Vercel runs its own build on its own servers and reads env vars from its dashboard, not your local `web/.env`. Local `.env` only affects `npm run dev` on your machine.

```bash
cd /home/c/.openclaw/workspace/everdraw-clean/web
# First remove the old value (Vercel doesn't let you overwrite without remove)
echo y | npx vercel env rm VITE_POOL_ADDRESSES_V3 production
# Then set the new value (both V3 vaults, comma-separated)
echo '0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee,<NEW_VAULT_B_ADDRESS>' | npx vercel env add VITE_POOL_ADDRESSES_V3 production
```

Also update local `web/.env` to match (for parity, not because Vercel reads it):
```
VITE_POOL_ADDRESSES_V3=0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee,<NEW_VAULT_B_ADDRESS>
```

### 10. Update Fly keeper secrets — must use `flyctl secrets set` (not `--stage`)

**Another gotcha:** `flyctl secrets set --stage` saves but doesn't apply. Use the plain form which auto-applies and restarts.

```bash
~/.fly/bin/flyctl secrets set -a everdraw-keeper \
  POOL_ADDRESSES='0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888,0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d,0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee,<NEW_VAULT_B_ADDRESS>' \
  POOL_ADDRESSES_V3='0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee,<NEW_VAULT_B_ADDRESS>' \
  POOL_SCHEDULE_V2='' \
  POOL_SCHEDULE_V3='0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee:Wed:13,<NEW_VAULT_B_ADDRESS>:Sun:1'
```

Notes:
- Remove V2 Vault B from `POOL_SCHEDULE_V2` (now empty) — its Sun anchor passes to V3 Vault B. The V2 vault stays in `POOL_ADDRESSES` for finalization of any in-flight rounds.
- Verify post-restart that env reached the running worker:
  ```bash
  ~/.fly/bin/flyctl ssh console -a everdraw-keeper -C '/usr/local/bin/node -e "console.log(process.env.POOL_SCHEDULE_V3)"'
  ```

### 11. Update Fly indexer secrets — same `--stage`-free pattern

```bash
~/.fly/bin/flyctl secrets set -a everdraw-indexer \
  POOL_ADDRESSES='0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888,0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d,0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a,0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee,<NEW_VAULT_B_ADDRESS>' \
  POOL_ADDRESSES_V3='0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee,<NEW_VAULT_B_ADDRESS>'
```

### 12. Reset indexer `last_finalized_block` to before Vault B deploy

**Without this, the indexer never picks up the Vault B deploy / round-1-start events** because it already scanned past those blocks under the old `POOL_ADDRESSES` (which didn't include the new vault address).

First find the deploy block from the tx in step 6. The deploy tx's block number is the floor.

```bash
# Upload the reset script (DB lives at /data/everdraw.db inside the container)
cat > /tmp/reset-finalized.cjs << 'JSEOF'
const Database = require('/app/node_modules/better-sqlite3');
const db = new Database('/data/everdraw.db');
const TARGET_BLOCK = process.env.RESET_BLOCK || '<DEPLOY_BLOCK_NUMBER - 100>';
const before = db.prepare('SELECT key,value FROM indexer_state WHERE key=?').get('last_finalized_block');
console.log('before:', before);
db.prepare('UPDATE indexer_state SET value=? WHERE key=?').run(TARGET_BLOCK, 'last_finalized_block');
const after = db.prepare('SELECT key,value FROM indexer_state WHERE key=?').get('last_finalized_block');
console.log('after:', after);
JSEOF

~/.fly/bin/flyctl ssh sftp shell -a everdraw-indexer <<EOSFTP
put /tmp/reset-finalized.cjs /app/reset-finalized.cjs
EOSFTP

~/.fly/bin/flyctl ssh console -a everdraw-indexer \
  -C "/usr/bin/env RESET_BLOCK=<DEPLOY_BLOCK_NUMBER - 100> /usr/local/bin/node /app/reset-finalized.cjs"
```

Wait ~2 minutes, then verify the indexer caught up and sees Vault B round 1:

```bash
curl -s 'https://everdraw-indexer.fly.dev/api/rounds?poolAddress=<NEW_VAULT_B_ADDRESS>' \
  | python3 -c 'import json,sys; rows=json.load(sys.stdin); v=[r for r in rows if r["poolAddress"].lower()=="<NEW_VAULT_B_ADDRESS>".lower()]; print("V3 Vault B rounds:", len(v)); [print(" ", r["roundId"], r["state"]) for r in v]'
```

### 13. Update deployment manifest and PR it to `staging`

```bash
git checkout -b record/vault-b-v3-deploy
```

Edit `deployments/monad-mainnet.json`, add a new entry for Vault B V3 mirroring the Vault A V3 block (insert before the Legacy Vault B entry):

```json
{
  "role": "Vault B (V3)",
  "status": "active",
  "address": "<NEW_VAULT_B_ADDRESS>",
  "contractName": "TicketPrizePoolShmonV3",
  "source": "src/TicketPrizePoolShmonV3.sol",
  "abi": "abi/TicketPrizePoolShmonV3.json",
  "deployedAt": "2026-05-31T01:00:00.000Z",
  "anchor": "Sun 01:00 UTC",
  "compiler": { "version": "0.8.33+commit.64118f21", "optimizer": true, "optimizerRuns": 200, "viaIR": true, "evmVersion": "paris" },
  "constructorArgs": {
    "ticketPriceMON": "1000000000000000000",
    "roundDurationSec": 86400,
    "yieldPeriodSec": 518100,
    "shmon": "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c",
    "entropy": "0xD458261E832415CFd3BAE5E416FdF3230ce6F134",
    "entropyProvider": "0x52DeaA1c84233F7bb8C8A45baeDE41091c616506"
  },
  "runtimeBytecodeSha256": "<SHA256 FROM STEP 8>",
  "verification": {
    "status": "verified",
    "verifiedAt": "2026-05-31T01:05:00.000Z",
    "method": "Runtime bytecode fetched via eth_getCode and SHA256-hashed post-deploy. Constructor args verified against ADR-0010 cadence and ADR-0019. VRF reserve seeded with 20 MON, keeper authorized via setKeeper.",
    "evidence": "decisions/0019-v3-mainnet-migration.md"
  },
  "adrs": ["ADR-0010", "ADR-0019", "ADR-0021"]
}
```

```bash
node scripts/check-production-source-manifest.mjs   # must pass
git add deployments/monad-mainnet.json
git commit -m "Record Vault B V3 deployment (ADR-0019, ADR-0021)

Contract: <NEW_VAULT_B_ADDRESS>
Deployed: 2026-05-31T01:00 UTC, Sun anchor.
VRF reserve seeded with 20 MON, keeper 0x80dE...DBE9 authorized.
Runtime bytecode hash verified post-deploy."
git push origin record/vault-b-v3-deploy
```

Open the PR with base = `staging` (NOT `main`):
**https://github.com/Gmankey/everdraw/compare/staging...record/vault-b-v3-deploy**

Wait for the `contracts` CI to go green (~5–7 min), then merge.

### 14. Deploy frontend

After step 13's PR is merged:

```bash
git checkout staging
git pull --rebase origin staging
bash scripts/deploy-frontend-prod.sh
```

Verify the new Vault B V3 address is in the live bundle:

```bash
HTML=$(curl -s https://everdraw.xyz/)
JS_URL=$(echo "$HTML" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | tail -1)
curl -s https://everdraw.xyz/$JS_URL | grep -c '<NEW_VAULT_B_ADDRESS>'   # must be ≥ 1
```

### 15. Restore stashed untracked files

```bash
mv /tmp/everdraw-untracked-stash/* /home/c/.openclaw/workspace/everdraw-clean/ 2>/dev/null
```

(Best-effort — paths with `:` like Zone.Identifier files may need a manual `mv`.)

---

## Verification checklist (do all of these before declaring done)

- [ ] Contract `VERSION()` returns `"3.0.0"`
- [ ] On-chain VRF reserve balance = 20 MON
- [ ] `isKeeper(0x80dE...DBE9)` returns true
- [ ] `currentRoundId` = 1 and round 1 is in `state = 0` (Open)
- [ ] `feeBps()` = 0 (default off)
- [ ] Indexer API returns a row for Vault B V3 round 1
- [ ] Fly keeper logs show 4 pools polled (2× V2 + 2× V3), all `idle action=None` initially
- [ ] Frontend Vault B button selects new V3 address (test with a hard refresh)
- [ ] Manifest PR merged to `staging` (CI green)
- [ ] V2 Vault B (`0xd4F4...`) still reachable via MyRounds for in-flight finalization

---

## Post-deploy follow-ups (within a day)

- Top up keeper hot wallet if it's near the 0.2 MON alert threshold. Each VRF callback costs the *vault* 0.77 MON from its reserve, but `commitDraw`/`settle`/`finalizeDraw` cost the *keeper* in gas.
- After V2 Vault B's final round settles and all depositors claim, remove `0xd4F4286...` from `POOL_SCHEDULE_V2` entirely (already done in this runbook — verify) and consider removing from `POOL_ADDRESSES` after a few weeks.

---

## Rollback

If anything goes catastrophically wrong before the manifest PR is merged:

1. **Stop the keeper from acting on the new vault:** `flyctl secrets set -a everdraw-keeper POOL_SCHEDULE_V3='0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee:Wed:13'` (removes the new Vault B from the schedule).
2. **Frontend stays on V2 Vault B:** don't deploy step 14; remove the new address from Vercel env. Users won't see the new contract.
3. **Indexer can stay tracking the new contract** — it's idempotent and harmless. Leave it as-is unless it's causing noise.
4. The deployed contract sits dormant. VRF reserve can be reclaimed via `withdrawVRFReserve(amount)` (owner-only) if you decide not to use it.

A clean post-mortem ADR (ADR-002X) documents what went wrong, what was rolled back, and when the next attempt will be.
