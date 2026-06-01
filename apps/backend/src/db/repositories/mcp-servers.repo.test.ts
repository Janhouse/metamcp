import { beforeEach, describe, expect, it, vi } from "vitest"

const returning = vi.fn()
const where = vi.fn().mockReturnValue({ returning })
const set = vi.fn().mockReturnValue({ where })
const update = vi.fn().mockReturnValue({ set })

vi.mock("../index", () => ({
  db: { update: (...a: unknown[]) => update(...a) },
}))

import { McpServersRepository } from "./mcp-servers.repo"

const repo = new McpServersRepository()

describe("McpServersRepository.resetAllErrorStatus", () => {
  beforeEach(() => {
    update.mockClear()
    set.mockClear()
    where.mockClear()
  })

  it("sets error_status back to NONE and returns the count reset", async () => {
    returning.mockResolvedValue([{ uuid: "a" }, { uuid: "b" }])
    const count = await repo.resetAllErrorStatus()
    expect(count).toBe(2)
    expect(set).toHaveBeenCalledWith({ error_status: "NONE" })
    expect(where).toHaveBeenCalledTimes(1) // scoped to ERROR rows only
  })

  it("returns 0 when nothing was in error", async () => {
    returning.mockResolvedValue([])
    await expect(repo.resetAllErrorStatus()).resolves.toBe(0)
  })
})
