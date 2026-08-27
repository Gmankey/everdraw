FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

# Build deps for better-sqlite3 native bindings
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Data directory for persistent SQLite volume
RUN mkdir -p /data

EXPOSE 3001

ENV DB_PATH=/data/everdraw.db
ENV PORT=3001
ENV NODE_ENV=production

CMD ["node_modules/.bin/tsx", "src/index.ts"]
