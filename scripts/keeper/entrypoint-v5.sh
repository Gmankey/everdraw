#!/bin/sh
set -u

# V5 keeper entrypoint. keeper-v5.js loops internally when KEEPER_LOOP=true, but a hard error
# (e.g. a transient public-RPC failure that escapes the internal loop) makes the process exit
# non-zero. Wrap it in an auto-restart loop so a crash recovers in seconds without waiting for a
# full Fly machine restart; Fly's restart policy is the outer backstop if this script itself dies.
# This mirrors the manual `while true; do node scripts/keeper-v5.js; sleep 5; done` an operator
# would run by hand -- now supervised, so the keeper no longer depends on a terminal staying open.

echo "[keeper-v5] entrypoint start"
echo "[keeper-v5] drawManager=${DRAW_MANAGER_ADDRESS:-<unset>} claimManager=${CLAIM_MANAGER_ADDRESS:-<unset>} fromBlock=${V5_KEEPER_FROM_BLOCK:-<unset>}"
if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "[keeper-v5] FATAL: PRIVATE_KEY not set (must be a Fly secret set by the operator)" >&2
fi

while true; do
  node scripts/keeper-v5.js
  code=$?
  echo "[keeper-v5] keeper-v5.js exited code=${code}; restarting in 5s"
  sleep 5
done
