import type {
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types"
import type { z } from "zod"

import logger from "@/utils/logger"

import {
  mcpServersRepository,
  oauthSessionsRepository,
} from "../db/repositories"
import { OAuthSessionsSerializer } from "../db/serializers"
import { canManageResource } from "../lib/authz"

/**
 * Verify the caller may access the MCP server's OAuth session (which holds the
 * upstream tokens and PKCE verifier). Only the server owner or an admin may —
 * a public server's session is NOT readable/writable by every user, otherwise
 * one tenant could read or overwrite another's upstream credentials.
 */
async function assertServerOwnership(
  userId: string,
  mcpServerUuid: string,
): Promise<void> {
  const server = await mcpServersRepository.findByUuid(mcpServerUuid)
  if (!server) {
    throw new Error("MCP server not found")
  }
  if (!(await canManageResource(server.user_id, userId))) {
    throw new Error("Access denied: you do not own this MCP server")
  }
}

export const oauthImplementations = {
  get: async (
    input: z.infer<typeof GetOAuthSessionRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof GetOAuthSessionResponseSchema>> => {
    try {
      await assertServerOwnership(userId, input.mcp_server_uuid)

      const session = await oauthSessionsRepository.findByMcpServerUuid(
        input.mcp_server_uuid,
      )

      if (!session) {
        return {
          success: false as const,
          message: "OAuth session not found",
        }
      }

      return {
        success: true as const,
        data: OAuthSessionsSerializer.serializeOAuthSession(session),
        message: "OAuth session retrieved successfully",
      }
    } catch (error) {
      logger.error("Error fetching OAuth session:", error)
      return {
        success: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch OAuth session",
      }
    }
  },

  upsert: async (
    input: z.infer<typeof UpsertOAuthSessionRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>> => {
    try {
      await assertServerOwnership(userId, input.mcp_server_uuid)

      const session = await oauthSessionsRepository.upsert({
        mcp_server_uuid: input.mcp_server_uuid,
        ...(input.client_information && {
          client_information: input.client_information,
        }),
        ...(input.tokens && { tokens: input.tokens }),
        ...(input.code_verifier && { code_verifier: input.code_verifier }),
      })

      if (!session) {
        return {
          success: false as const,
          error: "Failed to upsert OAuth session",
        }
      }

      return {
        success: true as const,
        data: OAuthSessionsSerializer.serializeOAuthSession(session),
        message: "OAuth session upserted successfully",
      }
    } catch (error) {
      logger.error("Error upserting OAuth session:", error)
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Internal server error",
      }
    }
  },
}
