#!/bin/sh

set -e

echo "Starting MetaMCP services..."

# Default Postgres connection details (used only to wait for readiness).
POSTGRES_HOST=${POSTGRES_HOST:-postgres}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
POSTGRES_USER=${POSTGRES_USER:-postgres}

wait_for_postgres() {
    echo "Waiting for PostgreSQL to be ready..."
    until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER"; do
        echo "PostgreSQL is not ready - sleeping 2 seconds"
        sleep 2
    done
    echo "PostgreSQL is ready!"
}

# Wait so the in-process migration step (see apps/backend/src/db/migrate.ts)
# doesn't fail-fast against a not-yet-ready database on a cold start.
wait_for_postgres

# Start the backend (Bun runtime, compiled bundle). Database migrations run
# in-process at boot from apps/backend/dist (replacing the old drizzle-kit
# CLI step); a migration failure aborts the process, detected below.
echo "Starting backend server..."
cd /app/apps/backend
PORT=12009 bun run dist/index.js &
BACKEND_PID=$!

# Give the backend a moment (DB connect + migrations + listen).
sleep 3
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌ Backend server died! (check migration/DB errors above) Exiting..."
    exit 1
fi
echo "✅ Backend server started successfully (PID: $BACKEND_PID)"

# Start the frontend (Bun runtime, Next.js standalone server).
echo "Starting frontend server..."
cd /app
PORT=12008 HOSTNAME=0.0.0.0 bun apps/frontend/server.js &
FRONTEND_PID=$!

sleep 3
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ Frontend server died! Exiting..."
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi
echo "✅ Frontend server started successfully (PID: $FRONTEND_PID)"

cleanup() {
    echo "Shutting down services..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true
    wait $FRONTEND_PID 2>/dev/null || true
    echo "Services stopped"
}

trap cleanup TERM INT

echo "Services started successfully!"
echo "Backend running on port 12009"
echo "Frontend running on port 12008"

wait $BACKEND_PID
wait $FRONTEND_PID
