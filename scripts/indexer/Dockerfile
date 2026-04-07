FROM node:20-slim

# Build deps for better-sqlite3 native bindings
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ ./src/

# Data directory for persistent SQLite volume
RUN mkdir -p /data

EXPOSE 3001

ENV DB_PATH=/data/everdraw.db
ENV PORT=3001
ENV NODE_ENV=production

CMD ["node_modules/.bin/tsx", "src/index.ts"]
