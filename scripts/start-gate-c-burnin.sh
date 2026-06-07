#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/c/.openclaw/workspace/monad-prize"
EVIDENCE="$ROOT/tasks/everdraw-gate-c-evidence-2026-03-02.md"
LOG="$ROOT/logs/gate-c-burnin-runner.log"

cd "$ROOT"

mkdir -p logs

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Gate C burn-in runner starting" | tee -a "$LOG"

sudo systemctl restart monad-prize-keeper.service

T0_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_LINE="$(grep -n "\[keeper\] start" logs/keeper.out.log | tail -n 1 || true)"

{
  echo ""
  echo "## Gate C fresh T0 anchor"
  echo "- T0 (UTC): $T0_UTC"
  echo "- Keeper start line: $START_LINE"
  echo "- Note: preflight must be true in start line"
} >> "$EVIDENCE"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] T0 captured" | tee -a "$LOG"

run_checkpoint() {
  local label="$1"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running checkpoint: $label" | tee -a "$LOG"
  bash "$ROOT/scripts/collect-gate-c-evidence.sh" "$label" | tee -a "$LOG"

  {
    echo "- settle-preflight proof ($label):"
    echo "  - $(grep -n "preflight=true" "$ROOT/logs/keeper.out.log" | tail -n 1 || echo 'preflight line not found')"
    echo "  - $(grep -n "settle precheck not ready" "$ROOT/logs/keeper.out.log" | tail -n 1 || echo 'no settle precheck line yet')"
  } >> "$EVIDENCE"

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Completed checkpoint: $label" | tee -a "$LOG"
}

sleep 6h
run_checkpoint "T+6h"

sleep 6h
run_checkpoint "T+12h"

sleep 12h
run_checkpoint "T+24h"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Gate C burn-in runner finished" | tee -a "$LOG"
