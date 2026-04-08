import { ServerParameters } from "@repo/zod-types";

import { mcpServersRepository, namespacesRepository } from "../db/repositories";
import { initializeEnvironmentConfiguration } from "./bootstrap.service";
import { metaMcpServerPool } from "./metamcp";
import { convertDbServerToParams } from "./metamcp/utils";

/**
 * Startup initialization that must happen before the HTTP server begins listening.
 *
 * IMPORTANT: This function does not prevent the app from starting unless BOOTSTRAP_FAIL_HARD=true.
 */
export async function initializeOnStartup(): Promise<void> {
  const parseBool = (value: string | undefined, defaultValue: boolean) => {
    if (value === undefined) return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
    return defaultValue;
  };

  const enableEnvBootstrap = parseBool(process.env.BOOTSTRAP_ENABLE, true);
  const failHard = parseBool(process.env.BOOTSTRAP_FAIL_HARD, false);

  if (enableEnvBootstrap) {
    try {
      await initializeEnvironmentConfiguration();
    } catch (err) {
      console.error(
        "❌ Error initializing environment-based configuration (ignored):",
        err,
      );
      if (failHard) {
        throw err;
      }
    }
  } else {
    console.log("Environment bootstrap disabled via BOOTSTRAP_ENABLE=false");
  }
}

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

/**
 * Wait for the backend to be ready by polling the health endpoint.
 */
async function waitForBackendReady(maxWaitMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch("http://localhost:12009/health");
      if (response.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Startup function to initialize idle servers for all namespaces and all MCP servers.
 * Uses batched warmup to prevent startup stampede.
 */
export async function initializeIdleServers() {
  try {
    // Wait for backend to be ready before initializing idle servers
    const ready = await waitForBackendReady();
    if (!ready) {
      console.log(
        "⚠️ Backend health check did not pass within timeout, proceeding anyway...",
      );
    }

    console.log(
      "Initializing idle servers for all namespaces and all MCP servers...",
    );

    // Fetch all namespaces from the database
    const namespaces = await namespacesRepository.findAll();
    const namespaceUuids = namespaces.map((namespace) => namespace.uuid);

    if (namespaceUuids.length === 0) {
      console.log("No namespaces found in database");
    } else {
      console.log(
        `Found ${namespaceUuids.length} namespaces: ${namespaceUuids.join(", ")}`,
      );
    }

    // Fetch ALL MCP servers from the database (not just namespace-associated ones)
    console.log("Fetching all MCP servers from database...");
    const allDbServers = await mcpServersRepository.findAll();
    console.log(`Found ${allDbServers.length} total MCP servers in database`);

    // Convert all database servers to ServerParameters format
    const allServerParams: Record<string, ServerParameters> = {};
    for (const dbServer of allDbServers) {
      const serverParams = await convertDbServerToParams(dbServer);
      if (serverParams) {
        allServerParams[dbServer.uuid] = serverParams;
      }
    }

    console.log(
      `Successfully converted ${Object.keys(allServerParams).length} MCP servers to ServerParameters format`,
    );

    // Initialize idle sessions in batches to prevent startup stampede
    if (Object.keys(allServerParams).length > 0) {
      const { mcpServerPool } = await import("./metamcp");
      const entries = Object.entries(allServerParams);

      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = Object.fromEntries(entries.slice(i, i + BATCH_SIZE));
        await mcpServerPool.ensureIdleSessions(batch);
        console.log(
          `Initialized batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(entries.length / BATCH_SIZE)} MCP server idle sessions`,
        );

        if (i + BATCH_SIZE < entries.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }
      console.log(
        "✅ Successfully initialized idle MCP server pool sessions for ALL servers",
      );
    }

    // Ensure idle servers for all namespaces in batches
    if (namespaceUuids.length > 0) {
      for (let i = 0; i < namespaceUuids.length; i += BATCH_SIZE) {
        const batch = namespaceUuids.slice(i, i + BATCH_SIZE);
        await metaMcpServerPool.ensureIdleServers(batch, true);

        if (i + BATCH_SIZE < namespaceUuids.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }
      console.log(
        "✅ Successfully initialized idle servers for all namespaces",
      );
    }

    console.log(
      "✅ Successfully initialized idle servers for all namespaces and all MCP servers",
    );
  } catch (error) {
    console.log("❌ Error initializing idle servers:", error);
    // Don't exit the process, just log the error
    // The server should still start even if idle server initialization fails
  }
}
