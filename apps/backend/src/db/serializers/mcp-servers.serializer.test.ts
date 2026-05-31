import { describe, expect, it } from "vitest"

import { McpServersSerializer } from "./mcp-servers.serializer"

const baseServer = {
  uuid: "s1",
  name: "srv",
  description: null,
  type: "STDIO",
  command: "node",
  args: [],
  env: { SECRET: "value" },
  url: null,
  error_status: null,
  created_at: new Date("2020-01-01T00:00:00Z"),
  bearerToken: "tok_123",
  headers: { Authorization: "Bearer x" },
  user_id: "owner",
} as any

describe("McpServersSerializer secret redaction", () => {
  it("includes secrets when not redacted", () => {
    const out = McpServersSerializer.serializeMcpServer(baseServer)
    expect(out.env).toEqual({ SECRET: "value" })
    expect(out.bearerToken).toBe("tok_123")
    expect(out.headers).toEqual({ Authorization: "Bearer x" })
  })

  it("strips secrets when redacted", () => {
    const out = McpServersSerializer.serializeMcpServer(baseServer, {
      redactSecrets: true,
    })
    expect(out.env).toEqual({})
    expect(out.bearerToken).toBeUndefined()
    expect(out.headers).toEqual({})
    // non-secret fields preserved
    expect(out.name).toBe("srv")
    expect(out.command).toBe("node")
  })

  it("list redacts secrets for servers the requester does not own", () => {
    const mine = { ...baseServer, uuid: "mine", user_id: "me" }
    const theirs = { ...baseServer, uuid: "theirs", user_id: "other" }
    const pub = { ...baseServer, uuid: "pub", user_id: null }
    const out = McpServersSerializer.serializeMcpServerList(
      [mine, theirs, pub],
      { requesterId: "me", isAdmin: false },
    )
    expect(out[0].bearerToken).toBe("tok_123") // owned → visible
    expect(out[1].bearerToken).toBeUndefined() // others' → redacted
    expect(out[2].bearerToken).toBeUndefined() // public → redacted
  })

  it("admin sees all secrets in a list", () => {
    const theirs = { ...baseServer, uuid: "theirs", user_id: "other" }
    const pub = { ...baseServer, uuid: "pub", user_id: null }
    const out = McpServersSerializer.serializeMcpServerList([theirs, pub], {
      requesterId: "admin",
      isAdmin: true,
    })
    expect(out[0].bearerToken).toBe("tok_123")
    expect(out[1].bearerToken).toBe("tok_123")
  })

  it("canSeeSecrets: owner or admin only; never for public to non-owner", () => {
    expect(McpServersSerializer.canSeeSecrets("me", "me", false)).toBe(true)
    expect(McpServersSerializer.canSeeSecrets("other", "me", false)).toBe(false)
    expect(McpServersSerializer.canSeeSecrets(null, "me", false)).toBe(false)
    expect(McpServersSerializer.canSeeSecrets(null, "me", true)).toBe(true)
  })
})
