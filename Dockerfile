# syntax=docker/dockerfile:1
# Production image for ReleaseRadar (P4). Multi-stage: compile + build in a fat
# builder, then ship only Next's `standalone` output in a slim runner.
# Runs on Railway (or any container host) with a persistent volume at /app/data.

# ── Builder ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 compiles a native addon → needs a C/C++ toolchain + python.
# (Builder and runner share this base image, so the compiled .node binary the
# build produces is ABI/glibc-compatible with the runtime.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps against the lockfile first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Runner ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# SQLite lives on the mounted volume, NOT in the image (else it resets each deploy).
ENV DB_PATH=/app/data/rr.db

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server bundle + static assets. `output: "standalone"` does not copy
# public/ or .next/static, so we add them next to the generated server.js.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Persistent SQLite data dir — mount a volume here (Railway: mount path /app/data).
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3000

# Next's minimal standalone server (honors PORT/HOSTNAME set above).
CMD ["node", "server.js"]
