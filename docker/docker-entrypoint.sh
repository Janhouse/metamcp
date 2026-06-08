#!/bin/sh

set -e

echo "Starting MetaMCP services..."

# The backend waits for Postgres itself before running migrations (see
# waitForDatabaseReady in apps/backend/src/db/index.ts), so there is no
# readiness wait here — no pg_isready, no postgresql-client in the image.

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
