import type {
  DatabaseOAuthSession,
  OAuthSessionCreateInput,
  OAuthSessionUpdateInput,
} from "@repo/zod-types"
import { eq, sql } from "drizzle-orm"

import { db } from "../index"
import { oauthSessionsTable } from "../schema"

export class OAuthSessionsRepository {
  async findByMcpServerUuid(
    mcpServerUuid: string,
  ): Promise<DatabaseOAuthSession | undefined> {
    const [session] = await db
      .select()
      .from(oauthSessionsTable)
      .where(eq(oauthSessionsTable.mcp_server_uuid, mcpServerUuid))
      .limit(1)

    return session
  }

  async create(input: OAuthSessionCreateInput): Promise<DatabaseOAuthSession> {
    const [createdSession] = await db
      .insert(oauthSessionsTable)
      .values({
        mcp_server_uuid: input.mcp_server_uuid,
        ...(input.client_information && {
          client_information: input.client_information,
        }),
        ...(input.tokens && { tokens: input.tokens }),
        ...(input.code_verifier && { code_verifier: input.code_verifier }),
      })
      .returning()

    return createdSession
  }

  async update(
    input: OAuthSessionUpdateInput,
  ): Promise<DatabaseOAuthSession | undefined> {
    const [updatedSession] = await db
      .update(oauthSessionsTable)
      .set({
        ...(input.client_information && {
          client_information: input.client_information,
        }),
        ...(input.tokens && { tokens: input.tokens }),
        ...(input.code_verifier && { code_verifier: input.code_verifier }),
        updated_at: sql`NOW()`,
      })
      .where(eq(oauthSessionsTable.mcp_server_uuid, input.mcp_server_uuid))
      .returning()

    return updatedSession
  }

  async upsert(input: OAuthSessionUpdateInput): Promise<DatabaseOAuthSession> {
    // Atomic upsert via the unique constraint on mcp_server_uuid. The previous
    // find-then-create/update was a TOCTOU race: two concurrent OAuth flows for
    // the same server (e.g. a double-fired auto-connect) could both miss the
    // existing row and both insert, or interleave writes, corrupting the stored
    // client_information/code_verifier and causing client-id/verifier mismatch
    // at token exchange. ON CONFLICT DO UPDATE makes it a single statement.
    const onlyProvided = {
      ...(input.client_information && {
        client_information: input.client_information,
      }),
      ...(input.tokens && { tokens: input.tokens }),
      ...(input.code_verifier && { code_verifier: input.code_verifier }),
    }

    const [session] = await db
      .insert(oauthSessionsTable)
      .values({
        mcp_server_uuid: input.mcp_server_uuid,
        ...onlyProvided,
      })
      .onConflictDoUpdate({
        target: oauthSessionsTable.mcp_server_uuid,
        set: {
          ...onlyProvided,
          updated_at: sql`NOW()`,
        },
      })
      .returning()

    if (!session) {
      throw new Error("Failed to upsert OAuth session")
    }
    return session
  }

  async deleteByMcpServerUuid(
    mcpServerUuid: string,
  ): Promise<DatabaseOAuthSession | undefined> {
    const [deletedSession] = await db
      .delete(oauthSessionsTable)
      .where(eq(oauthSessionsTable.mcp_server_uuid, mcpServerUuid))
      .returning()

    return deletedSession
  }
}

export const oauthSessionsRepository = new OAuthSessionsRepository()
