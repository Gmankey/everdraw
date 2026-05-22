#!/usr/bin/env bash
set -euo pipefail

echo "[forge-deploy] Running mainnet deploy preflight"
npm run deploy:preflight
npm run build
npm run check:abi
npm run check:deploy-source

if [ "$#" -eq 0 ]; then
  cat >&2 <<'EOF'
[forge-deploy] Refusing to guess a Forge deployment target.
Usage:
  npm run deploy:forge:mainnet -- script/YourDeployScript.s.sol:YourDeployScript --rpc-url "$MONAD_MAINNET_RPC_URL" --broadcast

Direct forge script ... --broadcast bypasses source-control preflight and is not valid release procedure.
EOF
  exit 2
fi

forge script "$@"
