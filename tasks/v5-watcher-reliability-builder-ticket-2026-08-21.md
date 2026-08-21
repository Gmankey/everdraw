# V5 watcher reliability before final UAT soak

**Decision:** ADR-0036 section 4.4 and `tasks/v5-offchain-pipeline-spec.md` section 3.

## Incident

The six-hour UAT soak produced paying draws correctly, but the independent GitHub watcher had
three coverage failures. Two runs exited on transient RPC failures and one reached the 45-minute
job timeout while repeatedly falling back to the public Monad testnet RPC. The workflow accepted
an optional logs RPC secret but ignored it in favor of that hardcoded public endpoint. Its
15-minute schedule also left no operator response margin inside UAT's 15-minute challenge window.

## Required behavior

- Keep the watcher outside Fly and read-only so it has no shared fate or credentials with the
  keeper.
- Poll UAT every five minutes and use the configured independent logs RPC.
- Retry transient provider startup and log-read failures with bounded exponential backoff.
- Persist scan progress after each completed chunk and save the Actions cache even on failure.
- Send an OK heartbeat only after the cursor reaches chain head.
- Treat verification with less than five minutes left in the UAT veto window as a coverage
  failure, alert once, and fail the run.
- Preserve exact JS/Python root parity and mismatch alerting.

## External dependencies and failure behavior

| Dependency | Failure behavior |
|---|---|
| GitHub Actions scheduler | A delayed run is detected by the independent Healthchecks dead-man check; verification inside the last five minutes of UAT's veto window fails the run. |
| Primary/archive RPC | Transient startup and call errors retry with bounded backoff; exhaustion sends Telegram and Healthchecks failure signals. |
| Logs RPC | Uses the configured independent secret, retries transient errors, then falls back to the primary RPC. |
| Actions cache | Cursor and event cache persist after every completed chunk and save even when a job fails; a cold cache backfills without sending a false OK heartbeat. |
| Telegram | Mismatch and watcher-failure messages are sent to the operator; Healthchecks remains the independent dead-man channel. |
| Healthchecks.io | Receives OK only at chain head and failure on actionable errors; its own notification integration is the backstop if Telegram delivery fails. |
## Gate


Start a new seven-day soak only after a dispatched run reaches chain head, a newly proposed real
root is recomputed within the timing budget, Telegram and Healthchecks are green, and no watcher
run fails or is cancelled during the acceptance window.

