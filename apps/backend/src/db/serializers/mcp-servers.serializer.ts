import type { DatabaseMcpServer, McpServer } from "@repo/zod-types"

export class McpServersSerializer {
  /**
   * Serialize a server for the API. When `redactSecrets` is true the
   * credential-bearing fields (bearerToken, env values, headers) are stripped.
   * Used when returning a server the requester does not own (e.g. a shared /
   * public server) so secrets are only ever exposed to the owner or an admin.
   */
  static serializeMcpServer(
    dbServer: DatabaseMcpServer,
    options: { redactSecrets?: boolean } = {},
  ): McpServer {
    const redact = options.redactSecrets === true
    return {
      uuid: dbServer.uuid,
      name: dbServer.name,
      description: dbServer.description,
      type: dbServer.type,
      command: dbServer.command,
      args: dbServer.args,
      env: redact ? {} : dbServer.env,
      url: dbServer.url,
      error_status: dbServer.error_status,
      created_at: dbServer.created_at.toISOString(),
      bearerToken: redact ? undefined : dbServer.bearerToken,
      headers: redact ? {} : dbServer.headers,
      user_id: dbServer.user_id,
      // Sandbox config is not a secret (no credentials) — never redacted.
      sandbox: dbServer.sandbox ?? null,
    }
  }

  /**
   * Serialize a list, redacting secrets on any server the requester does not
   * own (unless they are an admin). Pass the requester's id and admin flag.
   */
  static serializeMcpServerList(
    dbServers: DatabaseMcpServer[],
    options: { requesterId?: string; isAdmin?: boolean } = {},
  ): McpServer[] {
    const { requesterId, isAdmin = false } = options
    return dbServers.map((server) =>
      McpServersSerializer.serializeMcpServer(server, {
        redactSecrets: !McpServersSerializer.canSeeSecrets(
          server.user_id,
          requesterId,
          isAdmin,
        ),
      }),
    )
  }

  /** A requester may see a server's secrets only if they own it or are admin. */
  static canSeeSecrets(
    ownerId: string | null,
    requesterId: string | undefined,
    isAdmin: boolean,
  ): boolean {
    if (isAdmin) return true
    return ownerId !== null && ownerId === requesterId
  }
}
