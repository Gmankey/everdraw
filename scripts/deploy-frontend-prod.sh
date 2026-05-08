#!/usr/bin/env bash
set -euo pipefail

# Production frontend deploy guard.
# Refuses to deploy if the source is dirty or not pushed, so Vercel prod never
# becomes the only copy of frontend work again.

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

branch="$(git branch --show-current)"
if [[ "$branch" != "staging" ]]; then
  echo "Refusing prod deploy from branch '$branch'. Use staging." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing prod deploy: working tree has uncommitted changes." >&2
  git status --short >&2
  exit 1
fi

git fetch origin staging --quiet
local_sha="$(git rev-parse staging)"
remote_sha="$(git rev-parse origin/staging)"
if [[ "$local_sha" != "$remote_sha" ]]; then
  echo "Refusing prod deploy: staging is not pushed to origin/staging." >&2
  echo "local:  $local_sha" >&2
  echo "remote: $remote_sha" >&2
  exit 1
fi

for needle in PointsHeaderWidget setMaxTickets; do
  if ! grep -q "$needle" web/src/App.jsx; then
    echo "Refusing prod deploy: web/src/App.jsx is missing required UI marker '$needle'." >&2
    exit 1
  fi
done

(cd web && npm run build)
(cd web && npx vercel --prod --yes)
