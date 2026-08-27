FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

WORKDIR /app

# Install build deps for native modules in the keeper dependency tree.
RUN apt-get update && apt-get install -y python3 make g++ curl && rm -rf /var/lib/apt/lists/*

# Copy package manifests first for layer caching.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy keeper sources and runtime assets. Build context must be the repo root,
# not scripts/keeper, because the keeper imports sibling scripts and ABIs.
COPY scripts/keeper-watchdog.js ./scripts/
COPY scripts/keeper-alert-watcher.js ./scripts/
COPY scripts/keeper-execute-next.js ./scripts/
COPY scripts/keeper-active-pools.mjs ./scripts/
COPY scripts/keeper-health.sh ./scripts/
COPY scripts/keeper-env-check.sh ./scripts/
COPY scripts/keeper/entrypoint.sh ./scripts/keeper/
COPY abi/ ./abi/
COPY deployments/ ./deployments/

# keeper-watchdog.js currently supervises the historical absolute repo path.
# Preserve that path inside the container without changing keeper source logic.
RUN mkdir -p /home/c/.openclaw/workspace /app/logs \
  && ln -s /app /home/c/.openclaw/workspace/everdraw-clean \
  && chmod +x ./scripts/keeper/entrypoint.sh

CMD ["./scripts/keeper/entrypoint.sh"]
