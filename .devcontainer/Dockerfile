# DevContainer Dockerfile optimized for VS Code development
# Bun 1.4 (Rust build) is the dev runtime; Node + uv remain for spawning
# MCP servers as child processes during development.
FROM oven/bun:1.4 AS base

# Node.js + common development tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    gnupg \
    git \
    vim \
    nano \
    postgresql-client \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs docker.io tini \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# uv / uvx (Python-based MCP servers).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Development stage
FROM base AS dev
WORKDIR /workspaces/metamcp

# Set development environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=development
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true
ENV DEBIAN_FRONTEND=noninteractive

# Copy package files for dependency installation
# Note: Source code will be mounted as a volume, so we only need package files here
COPY package.json bun.lock bunfig.toml turbo.json ./

# Copy package.json files from all workspaces (needed for dependency installation)
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/
COPY packages/trpc/package.json ./packages/trpc/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/zod-types/package.json ./packages/zod-types/

# Install all dependencies (including dev dependencies)
# This will be cached and reused when the volume is mounted
RUN bun install

# Expose ports for frontend and backend
EXPOSE 12008 12009

# Health check for development
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:12008/health || exit 1

# Copy entrypoint script for manual use or docker-compose override
COPY docker/docker-entrypoint-dev.sh ./docker-entrypoint-dev.sh
RUN chmod +x docker-entrypoint-dev.sh

# Use Tini as the init process to handle signals and zombie processes properly
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command for devcontainer - keeps container running for VS Code to connect
# Can be overridden by devcontainer.json (overrideCommand: true) or docker-compose
# To start services manually, run: ./docker-entrypoint-dev.sh
CMD ["sleep", "infinity"]
