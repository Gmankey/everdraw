# V5 watcher continuous handoff

**Decision:** ADR-0036 section 4.4 and `tasks/v5-offchain-pipeline-spec.md` section 3.

## Problem

The activation runbook assumed the five-minute GitHub Actions schedule would keep a successor
queued while the current 50-minute worker ran. Live UAT run history instead showed multi-hour
gaps between successful workers. Green individual runs therefore did not establish continuous
root-watcher coverage.

## Required change

- Keep the watcher read-only and hosted outside Fly.
- At the end of every job, including a failed job, explicitly dispatch the next watcher run.
- Preserve the five-minute schedule as an independent recovery fallback.
- Preserve the single-running/single-pending concurrency lock and cache save on failure.
- Verify two consecutive jobs hand off without a Healthchecks coverage gap.

## External dependencies

- GitHub Actions dispatch: if explicit handoff fails, the scheduled trigger remains the fallback
  and the watcher Healthchecks dead-man check must alert.
- GitHub Actions cache: state is saved before successor dispatch, including on failure.
- Healthchecks and Telegram: unchanged; they remain independent evidence of liveness and mismatch.
