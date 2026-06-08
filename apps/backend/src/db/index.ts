import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import logger from "@/utils/logger"

import * as schema from "./schema"

const { DATABASE_URL, POSTGRES_CA_CERT } = process.env

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set")
}

// Use an explicit pg Pool so we can attach a global error handler.
// This prevents unhandled 'error' events from bringing down the Node process
// when the database terminates idle connections (e.g., during maintenance).
const pool = new Pool({
  connectionString: DATABASE_URL,
  ...(POSTGRES_CA_CERT && {
    ssl: {
      ca: POSTGRES_CA_CERT,
      rejectUnauthorized: true,
    },
  }),
})

pool.on("error", (err) => {
  // Log and continue so the process doesn't crash on idle client errors.
  // pg-pool will create a new client on the next checkout automatically.
  logger.error("PostgreSQL pool error (ignored):", err)
})

export const db = drizzle(pool, { schema })

/**
 * Block until the database accepts a connection, retrying with a fixed backoff.
 *
 * This replaces the shell-level pg_isready wait the Docker entrypoint used to
 * perform: the app now waits for its own dependency regardless of how it is
 * launched (compose healthcheck gating, k8s, or a bare process). Call it before
 * migrations so a not-yet-ready database on a cold start retries instead of
 * failing fast. Bounded by DB_CONNECT_MAX_WAIT_MS so a genuinely misconfigured
 * connection still surfaces an error instead of hanging forever.
 */
export async function waitForDatabaseReady(): Promise<void> {
  const retryDelayMs = Number(process.env.DB_CONNECT_RETRY_DELAY_MS ?? 2000)
  const maxWaitMs = Number(process.env.DB_CONNECT_MAX_WAIT_MS ?? 120000)
  const deadline = Date.now() + maxWaitMs

  for (let attempt = 1; ; attempt++) {
    try {
      const client = await pool.connect()
      try {
        await client.query("SELECT 1")
      } finally {
        client.release()
      }
      if (attempt > 1) {
        logger.info(`Database ready after ${attempt} attempts`)
      }
      return
    } catch (err) {
      if (Date.now() >= deadline) {
        logger.error(
          `Database not reachable after ${maxWaitMs}ms (${attempt} attempts); giving up`,
        )
        throw err
      }
      logger.warn(
        `Database not ready (attempt ${attempt}): ${
          (err as Error).message
        }. Retrying in ${retryDelayMs}ms...`,
      )
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }
}
