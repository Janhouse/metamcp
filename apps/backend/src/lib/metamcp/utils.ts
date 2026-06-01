import type { DatabaseMcpServer, ServerParameters } from "@repo/zod-types"

import logger from "@/utils/logger"

import { oauthSessionsRepository } from "../../db/repositories/oauth-sessions.repo"
import { getDefaultEnvironment } from "./sandbox"

// The env whitelist + scrubbing helpers now live in `sandbox.ts` (the single
// source of truth for the spawn environment). Re-exported here so the existing
// import sites (`./utils`) keep working.
export {
  buildChildEnv,
  DEFAULT_INHERITED_ENV_VARS,
  getDefaultEnvironment,
  resolveEnvVariables,
} from "./sandbox"

export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "")
}

/**
 * Converts a database MCP server record to ServerParameters format
 * @param server Database MCP server record
 * @returns ServerParameters object or null if conversion fails
 */
export async function convertDbServerToParams(
  server: DatabaseMcpServer,
): Promise<ServerParameters | null> {
  try {
    // Fetch OAuth tokens from OAuth sessions table
    const oauthSession = await oauthSessionsRepository.findByMcpServerUuid(
      server.uuid,
    )
    let oauthTokens = null

    if (oauthSession?.tokens) {
      oauthTokens = {
        access_token: oauthSession.tokens.access_token,
        token_type: oauthSession.tokens.token_type,
        expires_in: oauthSession.tokens.expires_in,
        scope: oauthSession.tokens.scope,
        refresh_token: oauthSession.tokens.refresh_token,
      }
    }

    const params: ServerParameters = {
      uuid: server.uuid,
      name: server.name,
      description: server.description || "",
      type: server.type || "STDIO",
      command: server.command,
      args: server.args || [],
      env: server.env || {},
      url: server.url,
      created_at: server.created_at?.toISOString() || new Date().toISOString(),
      status: "active", // Default status for non-namespace servers
      stderr: "inherit" as const,
      oauth_tokens: oauthTokens,
      bearerToken: server.bearerToken,
      headers: server.headers || {},
      sandbox: server.sandbox ?? null,
    }

    // Process based on server type
    if (params.type === "STDIO") {
      if ("args" in params && !params.args) {
        params.args = undefined
      }

      params.env = {
        ...getDefaultEnvironment(),
        ...(params.env || {}),
      }
    } else if (params.type === "SSE" || params.type === "STREAMABLE_HTTP") {
      // For SSE or STREAMABLE_HTTP servers, ensure url is present
      if (!params.url) {
        logger.warn(
          `${params.type} server ${params.uuid} is missing url field, skipping`,
        )
        return null
      }
    }

    return params
  } catch (error) {
    logger.error(`Error converting server ${server.uuid} to parameters:`, error)
    return null
  }
}
