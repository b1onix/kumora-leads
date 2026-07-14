# LeadExtractor dashboard — production image.
#
# Two-stage build:
#   1) builder: install ALL deps (native better-sqlite3 needs a C++ toolchain)
#      and compile the React client with Vite.
#   2) runtime: a slim image with only production deps + the built client.
#
# better-sqlite3 is a native addon. node:22-bookworm-slim has no compiler, so we
# add build-essential + python3 in the builder. If a prebuilt binary is
# available for this Node/platform, npm uses it and the compile is skipped; the
# tools just guarantee the build never fails when it isn't.

# ── stage 1: build ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Toolchain for compiling native modules (better-sqlite3).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps first (cached unless package files change).
COPY package.json package-lock.json ./
RUN npm ci

# Build the client (outputs to dist/, which the server serves in production).
COPY . .
RUN npm run build

# ── stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Toolchain also needed here IF the production reinstall has to rebuild the
# native addon from source. Kept minimal and cleaned up in the same layer.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Production-only dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App source + the client build from stage 1.
COPY server ./server
COPY --from=builder /app/dist ./dist

# The DB lives on a mounted volume (see SQLITE_PATH / DATA_DIR). Default path is
# inside the image, but you should mount a volume here in Dokploy so data
# survives redeploys.
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 4820
CMD ["node", "server/index.js"]
