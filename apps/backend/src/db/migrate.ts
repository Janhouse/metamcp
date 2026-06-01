import { join } from "node:path"

import { migrate } from "drizzle-orm/node-postgres/migrator"

import logger from "@/utils/logger"

import { db } from "./index"

/**
 * Apply pending Drizzle migrations at startup.
 *
 * Replaces the old `drizzle-kit migrate` CLI step that ran from the Docker
 * entrypoint. Reuses the existing pooled `db` connection and resolves the
 * migrations directory relative to the process working directory: the backend
 * is always started from `apps/backend` (the prod entrypoint `cd`s there; dev
 * runs via `bun --watch` from the same dir), and the SQL files ship at
 * `<cwd>/drizzle`. This stays correct under `bun build` bundling, where
 * `import.meta.url` would otherwise resolve next to `dist/`.
 *
 * Fails fast: a migration error propagates so startup aborts before the HTTP
 * server begins listening — matching the previous entrypoint behavior, which
 * exited the container on migration failure.
 */
export async function runMigrations(): Promise<void> {
  const skip = (process.env.SKIP_DB_MIGRATIONS ?? "").trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(skip)) {
    logger.warn("Skipping database migrations (SKIP_DB_MIGRATIONS is set)")
    return
  }

  const migrationsFolder = join(process.cwd(), "drizzle")
  logger.info(`Running database migrations from ${migrationsFolder}...`)
  await migrate(db, { migrationsFolder })
  logger.info("Database migrations applied")
}
