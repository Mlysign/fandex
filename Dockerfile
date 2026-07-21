# syntax=docker/dockerfile:1
# Production image for Fandex (P4). Multi-stage: compile + build in a fat
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
# Cap the V8 heap. Uncapped, V8 sizes itself off the host's RAM (Railway boxes
# are big) and collects lazily, so RSS ramps into multiple GB of billed memory
# even when the live set is a few hundred MB (observed 2026-07-20: ~4GB and
# climbing under crawler load). 1536MB forces GC well before that while leaving
# generous headroom over the bounded in-process caches; native memory (sharp,
# SQLite) sits on top. If the app ever OOMs or GC-thrashes, raise to 2048.
ENV NODE_OPTIONS="--max-old-space-size=1536"
# glibc opens up to 8 malloc arenas PER CORE and sizes them off the host's core
# count, not the container's CPU limit. Freed native memory then sits in those
# arenas instead of going back to the OS, so RSS ratchets up under any
# multi-threaded native workload and never comes back down — which is what the
# 2026-07-21 ramp looked like (7.5 GB RSS against a 1.5 GB heap cap). Capping
# arenas trades a little allocator contention for RSS that actually plateaus.
# Applies to every native allocator in the process (better-sqlite3, zlib, TLS).
ENV MALLOC_ARENA_MAX=2

# Standalone server bundle + static assets. `output: "standalone"` does not copy
# public/ or .next/static, so we add them next to the generated server.js.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# SQLite lives on a Railway Volume mounted at /app/data (configured in the Railway
# dashboard — NOT a Docker `VOLUME`, which Railway's builder rejects). Just ensure
# the mount point exists. We run as root so the process can always write to the
# Railway-mounted volume (Railway mounts volumes owned by root, so a non-root user
# couldn't create rr.db). Fine for a single-tenant app; non-root is a hardening follow-up.
RUN mkdir -p /app/data

# CA certificates so the Litestream Go binary can verify TLS to R2/S3 at runtime.
# (Node bundles its own CAs, but the litestream binary uses the OS trust store,
# which the slim base image lacks → "certificate signed by unknown authority".)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Litestream for continuous SQLite backups (P5). Static Go binary from the release
# .deb. Backups are OPT-IN: the entrypoint only activates Litestream when
# AWS_S3_BUCKET_NAME is set (the Railway bucket injects the AWS_* creds), otherwise
# it runs `node server.js` directly.
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb /tmp/litestream.deb
RUN dpkg -i /tmp/litestream.deb && rm /tmp/litestream.deb
COPY litestream.yml /etc/litestream.yml
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

# Entrypoint runs the standalone server (honors PORT/HOSTNAME), optionally wrapped
# in Litestream replication. server.js is Next's minimal standalone server.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
