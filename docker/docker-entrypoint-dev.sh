#!/bin/sh

set -e

echo "🚀 Starting MetaMCP development services..."
echo "📁 Working directory: $(pwd)"
echo "🔍 Node version: $(node --version)"
echo "📦 Bun version: $(bun --version)"

# Wait for Postgres if compose didn't already gate startup
if command -v pg_isready >/dev/null 2>&1; then
    echo "⏳ Checking PostgreSQL readiness..."
    until pg_isready -h "${POSTGRES_HOST:-postgres}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-metamcp_user}" >/dev/null 2>&1; do
        echo "🔁 PostgreSQL not ready yet, retrying in 2s..."
        sleep 2
    done
    echo "✅ PostgreSQL is ready"
else
    echo "ℹ️ pg_isready not found; relying on docker-compose healthcheck"
fi

# Function to cleanup on exit
cleanup_on_exit() {
    echo "🛑 SHUTDOWN: Received shutdown signal, cleaning up..."

    # Kill the dev process
    if [ -n "$DEV_PID" ]; then
        echo "🛑 SHUTDOWN: Killing dev process (PID: $DEV_PID)"
        kill -TERM "$DEV_PID" 2>/dev/null || true
    fi

    # Kill any other background processes
    jobs -p | xargs -r kill 2>/dev/null || true
    echo "🛑 SHUTDOWN: Killed background processes"

    echo "🛑 SHUTDOWN: Development services stopped"
    exit 0
}

# Setup cleanup trap for multiple signals
trap cleanup_on_exit TERM INT EXIT

echo "🔧 Setting up development environment..."
echo "📊 Backend will run on port 12009"
echo "🌐 Frontend will run on port 12008"
echo "🔄 Hot reloading is enabled for both frontend and backend"

# Ensure dependencies are up to date
echo "📦 Checking dependencies..."
bun install

# Database migrations now run in-process when the backend boots
# (see apps/backend/src/db/migrate.ts) — no separate CLI step needed here.
# For a manual migration you can still run: bun --filter backend run db:migrate

# Start the development servers with proper signal handling
echo "🚀 Starting 'bun run dev' with turborepo..."
echo "💡 This will start both frontend and backend in development mode"
bun run dev &
DEV_PID=$!
echo "🚀 dev started with PID: $DEV_PID"

# Wait for the dev process, but don't block cleanup
wait "$DEV_PID" || true
