import { beforeEach, describe, expect, it, vi } from "vitest"

const returning = vi.fn()
const onConflictDoUpdate = vi.fn().mockReturnValue({ returning })
const values = vi.fn().mockReturnValue({ onConflictDoUpdate })
const insert = vi.fn().mockReturnValue({ values })
const select = vi.fn() // must NOT be used by upsert (no TOCTOU read)

vi.mock("../index", () => ({
  db: {
    insert: (...a: unknown[]) => insert(...a),
    select: (...a: unknown[]) => select(...a),
  },
}))

import { OAuthSessionsRepository } from "./oauth-sessions.repo"

const repo = new OAuthSessionsRepository()

describe("OAuthSessionsRepository.upsert (atomic)", () => {
  beforeEach(() => {
    insert.mockClear()
    values.mockClear()
    onConflictDoUpdate.mockClear()
    select.mockClear()
    returning.mockResolvedValue([{ uuid: "s1", mcp_server_uuid: "srv1" }])
  })

  it("performs a single INSERT ... ON CONFLICT DO UPDATE (no prior read)", async () => {
    const result = await repo.upsert({
      mcp_server_uuid: "srv1",
      tokens: { access_token: "tok" },
    } as any)

    expect(insert).toHaveBeenCalledTimes(1)
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1)
    // The race-prone read-before-write path must not run.
    expect(select).not.toHaveBeenCalled()
    expect(result).toEqual({ uuid: "s1", mcp_server_uuid: "srv1" })
  })

  it("only writes the fields that were provided", async () => {
    await repo.upsert({
      mcp_server_uuid: "srv1",
      code_verifier: "verifier",
    } as any)

    const inserted = values.mock.calls[0][0] as Record<string, unknown>
    expect(inserted).toMatchObject({
      mcp_server_uuid: "srv1",
      code_verifier: "verifier",
    })
    expect(inserted).not.toHaveProperty("tokens")

    const conflict = onConflictDoUpdate.mock.calls[0][0] as {
      set: Record<string, unknown>
    }
    expect(conflict.set).toHaveProperty("code_verifier", "verifier")
    expect(conflict.set).toHaveProperty("updated_at") // bumped on update
    expect(conflict.set).not.toHaveProperty("tokens")
  })

  it("throws if the upsert returns no row", async () => {
    returning.mockResolvedValue([])
    await expect(
      repo.upsert({ mcp_server_uuid: "srv1" } as any),
    ).rejects.toThrow(/failed to upsert/i)
  })
})
