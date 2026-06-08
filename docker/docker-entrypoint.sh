#!/bin/sh

set -e

echo "Starting MetaMCP services..."

# Default Postgres connection details (used only to wait for readiness).
POSTGRES_HOST=${POSTGRES_HOST:-postgres}
POSTGRES_PORT=${POSTGRES_PORT:-5432}

# Probe the Postgres TCP port with Bun (already in the image) instead of
# pg_isready. This drops the postgresql-client apt package, which depended on
# Perl and dragged a large CVE surface into the image for a single readiness
# check. A successful TCP connect is enough: Postgres binds its port only once
# it is accepting connections, and the backend then runs migrations in-process
# (apps/backend/src/db/migrate.ts) with its own connection handling.
wait_for_postgres() {
    echo "Waiting for PostgreSQL to be ready..."
    until POSTGRES_HOST="$POSTGRES_HOST" POSTGRES_PORT="$POSTGRES_PORT" bun -e '
      const ok = await Bun.connect({
        hostname: process.env.POSTGRES_HOST || "postgres",
        port: Number(process.env.POSTGRES_PORT || 5432),
        socket: { open(s) { s.end(); }, data() {}, error() {} },
      }).then(() => true).catch(() => false);
      process.exit(ok ? 0 : 1);
    '; do
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
