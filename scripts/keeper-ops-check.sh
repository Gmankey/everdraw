#!/usr/bin/env bash
set -euo pipefail

cd /home/c/.openclaw/workspace/monad-prize

LABEL="${1:-manual}"
EVIDENCE_FILE="${2:-tasks/everdraw-gate-c-evidence-2026-03-02.md}"

echo "== keeper ops check =="
echo "label: ${LABEL}"
echo "evidence: ${EVIDENCE_FILE}"
echo

echo "[1/3] Health check"
bash scripts/keeper-health.sh

echo
echo "[2/3] Telegram alert test"
bash scripts/keeper-alert-test.sh

echo
echo "[3/3] Append evidence checkpoint"
bash scripts/collect-gate-c-evidence.sh "$LABEL" "$EVIDENCE_FILE"

echo
echo "[ok] keeper ops check complete"
