# V5 Root Watcher Activation Runbook

## Purpose

Run the V5 root watcher outside Fly on GitHub Actions. Each job is a managed 50-minute worker that polls once per minute; the five-minute schedule keeps a successor queued under the workflow's concurrency lock. The watcher is read-only: it reconstructs each proposed root from chain events, compares the Python reference result with the on-chain root, sends an alarm on a mismatch, and pings an independent Healthchecks check only after its cursor reaches chain head with adequate veto time remaining.

The keeper's files, Fly volume, RPC, and credentials are not used by this worker.

## Preconditions

- The active V5 deployment is recorded in `deployments/monad-testnet.json`.
- The repository branch contains `.github/workflows/v5-watcher.yml`.
- The watcher RPC is independent from the Fly keeper RPC and can read historical state at seed blocks.
- A separate Healthchecks check exists for the watcher.

- The Healthchecks period and grace are short enough to detect two missed five-minute workflow
  runs; for the 15-minute UAT challenge window, use a five-minute period and five-minute grace.

## Configure Repository Secrets

Run these locally after authenticating the GitHub CLI. The prompts keep values out of terminal history and chat.

```bash
read -rsp "UAT watcher archive RPC URL: " V5_WATCHER_UAT_RPC_URL
echo
printf %s "$V5_WATCHER_UAT_RPC_URL" | gh secret set V5_WATCHER_UAT_RPC_URL --repo Gmankey/everdraw

read -rsp "UAT watcher wide-range logs RPC URL (optional; Enter to reuse watcher RPC): " V5_WATCHER_UAT_LOGS_RPC_URL
echo
if [ -n "$V5_WATCHER_UAT_LOGS_RPC_URL" ]; then
  printf %s "$V5_WATCHER_UAT_LOGS_RPC_URL" | gh secret set V5_WATCHER_UAT_LOGS_RPC_URL --repo Gmankey/everdraw
fi

read -rsp "Watcher Healthchecks ping URL: " V5_WATCHER_UAT_HEALTHCHECK_URL
echo
printf %s "$V5_WATCHER_UAT_HEALTHCHECK_URL" | gh secret set V5_WATCHER_UAT_HEALTHCHECK_URL --repo Gmankey/everdraw

unset V5_WATCHER_UAT_RPC_URL V5_WATCHER_UAT_LOGS_RPC_URL V5_WATCHER_UAT_HEALTHCHECK_URL
```

`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are shared repository secrets. Set them separately only if they do not already exist.

## Verify UAT

1. Dispatch the watcher after the PR is merged to `staging`:

   ```bash
   gh workflow run v5-watcher.yml --repo Gmankey/everdraw --ref staging
   gh run list --repo Gmankey/everdraw --workflow v5-watcher.yml --limit 3
   ```

2. Open the dispatched run. It should remain in progress for approximately 50 minutes. During
   bootstrap, an individual scan is capped at eight minutes and resumes from its last persisted
   log window; the job can remain red until a complete scan reaches chain head. Once caught up,
   it logs `watcher checked N RootProposed events` once per polling cycle and fails if it has no
   successful chain-head scan for ten minutes.
3. Confirm the numeric `through block` equals `chain head`; bootstrap progress does
   not send an OK heartbeat until it catches up.
4. Confirm the watcher Healthchecks check is green.
5. During the veto drill, confirm a deliberately bad root creates a Telegram + Healthchecks failure alarm before the challenge window expires.
6. Confirm the worker exits normally rather than hitting the 60-minute job timeout, its cache-save
   step succeeds, and a scheduled successor is queued or starts after it exits. A handoff gap that
   trips Healthchecks invalidates the soak window.

## Mainnet

Do not enable a mainnet schedule until the V5 mainnet deployment is recorded and the same three conditions are met: separate archive RPC, separate Healthchecks check, and a successful manual dispatch against the recorded mainnet DrawManager. Use distinct mainnet secret names and a distinct Healthchecks check.
