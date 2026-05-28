# Working rule: a change is not complete until the user-visible UI reflects it

**For Claude (and any other agent) working on EverDraw.**
**Established:** 2026-05-29
**Triggered by:** Operator repeatedly catching me declare work "done" when it had only reached an intermediate state (branch pushed, PR open, code merged) but had not yet propagated to the live user-facing surface. Recent specific examples:
- 2026-05-27: Said "frontend deployed" after running the deploy script, without realizing Vercel reads env vars from its dashboard not the local `.env`, so the live bundle was missing the new V3 address.
- 2026-05-27: Said "indexer secrets updated" after `flyctl secrets set --stage`, without realizing `--stage` saves but does not apply; the running indexer kept the old env.
- 2026-05-29: Said "docs done" after pushing the PR branch, without verifying the live `docs.everdraw.xyz` actually showed the new content.

In each case, the artifact existed (committed code, set secret, written doc) but the **user-visible state had not changed.** The operator caught it; I had not.

---

## The rule

**A change is not complete until you have observed the user-visible surface reflecting the change.** Not the artifact. Not the intermediate state. The actual rendered page, deployed binary, or live API response that a real user would interact with.

Concretely: for any change that has a user-visible end state, your "done" checklist must include a step that **fetches the live surface and confirms the change is present**. Not "the PR is merged." Not "the deploy command exited 0." The thing the user actually sees.

This applies to:

- **Frontend changes.** Fetch the live URL (`curl https://everdraw.xyz`), find the JS bundle, grep it for the new address/string/feature. If the change is visual, take a screenshot or describe what to look for. Do not declare done until the live bundle contains the expected content.
- **Docs changes.** Fetch the live docs URL (`curl https://docs.everdraw.xyz/<page>`), grep for the new text or absence of the old text. Do not declare done until the live page reflects the edit.
- **Backend / indexer changes.** Fetch the live API endpoint, verify the new behavior is present in the response. Confirm the running deployment is the new version (machine version number, image hash, deployed-at timestamp).
- **Contract / on-chain changes.** Read the relevant on-chain state via a fresh RPC call (not a cached one). Confirm the storage slot, event, or function return reflects the change. Do not rely on tx receipt success alone — verify the post-state.
- **Env / secrets / config changes on hosted infra.** SSH or remote-exec into the running container if needed to confirm the env var is in `process.env` of the live worker, not just in the platform's secret store.

## What "user-visible" means precisely

Different surfaces have different definitions of "user-visible":

| Surface | User-visible means |
|---|---|
| Frontend (`everdraw.xyz`) | The bundle served from the production hostname, after CDN cache purge if applicable |
| Docs site (`docs.everdraw.xyz`) | The rendered HTML at the production hostname |
| Indexer API (`everdraw-indexer.fly.dev`) | The JSON returned by the production endpoint |
| Keeper | The behavior visible in logs (`flyctl logs -a everdraw-keeper`) or via on-chain side-effects |
| Contracts | The on-chain state, fetched via RPC, confirmed in a fresh call after the change is supposed to be live |

For each, the verification command should be in your working notes, and you should run it before declaring done.

## Common intermediate states that are NOT "done"

These are progress markers, not the finish line. Treat any of them as "in progress" until the user-visible surface is verified:

- ✗ "I wrote the code." → in progress
- ✗ "I committed it." → in progress
- ✗ "I pushed the branch." → in progress
- ✗ "The PR is open." → in progress
- ✗ "CI passed." → in progress
- ✗ "PR is merged." → in progress (Vercel/Fly may still be deploying; CDN may be cached; secret may need a restart)
- ✗ "The deploy command exited 0." → in progress (the deploy may have built the wrong source; the build may have used the wrong env vars; the new version may not have actually rolled out to all machines)
- ✓ "I fetched the live surface and observed the change." → done

## Why this happens (and why it keeps happening)

It happens because in each layer the work *feels* finished:

- Writing the code feels like building
- Committing feels like saving
- Pushing feels like shipping
- Merging feels like landing
- Deploying feels like releasing

But each of those layers has its own failure modes that don't surface as errors at that layer. Vercel silently uses its own dashboard env vars. Fly silently keeps the old secrets if you use `--stage`. CDNs silently serve cached responses. Build pipelines silently use the wrong branch.

The only signal that integrates all of them is the user-visible surface itself. **That's why it's the only acceptable definition of done.**

## How to apply the rule in practice

Before any "done" announcement, walk through this checklist mentally (or write it out for nontrivial changes):

1. **What user-visible surface should reflect this change?** Frontend page? Docs page? API response? On-chain state? Telegram alert?
2. **What is the exact verification command?** A `curl`, a `cast call`, an `ssh ... -C 'printenv X'`, a screenshot description.
3. **What is the expected output?** The new address, the new text, the new event, the new behavior.
4. **Run the command. Did the expected output appear?** If yes: done. If no: investigate before declaring anything.

If the change isn't expected to be user-visible immediately (e.g., scheduled deploy, awaiting external action), say so explicitly: "the change is staged and will reflect at <X> on <Y>; I will re-verify at that time." Do not let the gap between "I did the thing" and "the user can see it" go unannounced.

## Concrete verification recipes

### Frontend live-bundle check
```bash
HTML=$(curl -s https://everdraw.xyz/)
JS_URL=$(echo "$HTML" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | tail -1)
curl -s "https://everdraw.xyz/$JS_URL" | grep -c '<EXPECTED_STRING>'
# > 0 = change is live
```

### Docs page check
```bash
curl -s 'https://docs.everdraw.xyz/<path>' | grep -E '<expected text>' | head -3
# Lines printed = change is live
```

### Indexer API check
```bash
curl -s https://everdraw-indexer.fly.dev/api/<endpoint> | python3 -m json.tool | head -20
# Compare against expected response shape
```

### Fly secret applied to running container
```bash
flyctl ssh console -a <app> -C '/usr/local/bin/node -e "console.log(process.env.<NAME>)"'
# Confirm the value is what you set
```

### On-chain state after a tx
```bash
node -e "
const { JsonRpcProvider, Contract } = require('ethers');
const p = new JsonRpcProvider('https://rpc.monad.xyz');
const c = new Contract('<address>', ['function <view>() view returns (<type>)'], p);
c.<view>().then(v => console.log(v.toString()));
"
# Compare against expected post-state
```

## Related

- ADR-0017 — Production source-control invariant (production must never be ahead of git; this rule's converse: git must not be ahead of production-as-visible)
- `memory/working_rule_external_dependencies.md` — the analogous rule for design coverage
- `tasks/disaster-recovery-runbook.md` — operational counterpart for verifying state after recovery
