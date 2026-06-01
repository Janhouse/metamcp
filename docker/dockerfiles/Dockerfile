# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# MetaMCP production image
#
# Bun canary (the Rust build) is the application runtime for BOTH the backend
# (a compiled, self-contained bundle) and the frontend (Next.js standalone
# output). Node, uv and Go remain installed because MCP servers are spawned as
# child processes and may be node/npx, Python (uvx) or Go (`go run`) programs.
# ---------------------------------------------------------------------------
FROM oven/bun:canary AS base

# Node.js (for node/npx-based MCP servers). bash is needed by the NodeSource
# setup script. ca-certificates/gnupg for the apt repo signing key.
# bubblewrap = opt-in per-process MCP sandbox (MCP_SANDBOX=bwrap); util-linux
# provides prlimit for per-MCP resource limits (MCP_LIMIT_*).
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs bubblewrap util-linux \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# uv / uvx (for Python-based MCP servers) — static binaries from the official image.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Go (for Go-based MCP servers run via `go run`).
ARG TARGETARCH
ENV GO_VERSION=1.23.4
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${TARGETARCH}.tar.gz" -o /tmp/go.tar.gz \
    && tar -C /usr/local -xzf /tmp/go.tar.gz \
    && rm /tmp/go.tar.gz
ENV GOPATH=/go
ENV GOCACHE=/go/.cache
ENV PATH="/usr/local/go/bin:${GOPATH}/bin:${PATH}"
RUN mkdir -p "${GOPATH}/bin" "${GOPATH}/src" "${GOPATH}/pkg" "${GOCACHE}" \
    && chmod -R 777 /go

ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
# deps — install workspace dependencies (layer cached on the lockfile).
# `bun install --frozen-lockfile` needs every workspace package.json present.
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/
COPY packages/trpc/package.json ./packages/trpc/
COPY packages/zod-types/package.json ./packages/zod-types/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# builder — build shared packages (tsup), compile the backend to a
# self-contained bundle (bun build), and produce the frontend standalone output.
# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages/trpc/node_modules ./packages/trpc/node_modules
COPY --from=deps /app/packages/zod-types/node_modules ./packages/zod-types/node_modules
COPY . .
RUN bunx turbo run build

# ---------------------------------------------------------------------------
# runner — lean: Bun + Node/uv/Go runtimes + self-contained app artifacts.
# No application node_modules are needed: the backend bundle and the Next.js
# standalone server both inline their dependencies.
# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/metatool-ai/metamcp"
LABEL org.opencontainers.image.description="MetaMCP - aggregates MCP servers into a unified MetaMCP"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.title="MetaMCP"
LABEL org.opencontainers.image.vendor="metatool-ai"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# curl for the healthcheck, postgresql-client for pg_isready in the entrypoint.
RUN apt-get update && apt-get install -y --no-install-recommends curl postgresql-client \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Non-root user with a real home for any runtime caches (npx/uv/go).
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 --home /home/nextjs nextjs \
    && mkdir -p /home/nextjs/.cache \
    && chown -R nextjs:nodejs /home/nextjs

# Backend: self-contained compiled bundle + migration SQL (no node_modules).
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/drizzle ./apps/backend/drizzle

# Frontend: Next.js standalone output (bundles its own minimal node_modules).
# Copying .next/standalone to /app yields /app/apps/frontend/server.js.
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/public ./apps/frontend/public

# Pre-create the Next image-optimizer cache dir with correct ownership.
RUN mkdir -p /app/apps/frontend/.next/cache \
    && chown -R nextjs:nodejs /app/apps/frontend/.next

COPY --chown=nextjs:nodejs docker/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

USER nextjs

# Frontend port (the only public one; backend stays internal on 12009).
EXPOSE 12008

HEALTHCHECK --interval=30s --timeout=30s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:12008/health || exit 1

CMD ["./docker-entrypoint.sh"]
