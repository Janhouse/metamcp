import { beforeEach, describe, expect, it, vi } from "vitest"

// In-memory user store backing a minimal Drizzle-like select chain.
const users = new Map<string, { id: string; role: string }>()

vi.mock("../index", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (predicate: (u: { id: string; role: string }) => boolean) =>
          Array.from(users.values()).filter(predicate),
      }),
    }),
  },
}))

// eq(column, value) — return a predicate the mocked .where can apply. Keep the
// rest of drizzle-orm intact (schema.ts relies on sql`` etc.).
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>()
  return {
    ...actual,
    eq: (_col: unknown, value: string) => (row: { id: string }) =>
      row.id === value,
  }
})

import { UsersRepository } from "./users.repo"

const repo = new UsersRepository()

describe("UsersRepository.isAdmin", () => {
  beforeEach(() => {
    users.clear()
    users.set("admin1", { id: "admin1", role: "admin" })
    users.set("user1", { id: "user1", role: "user" })
  })

  it("returns true only for users with the admin role", async () => {
    await expect(repo.isAdmin("admin1")).resolves.toBe(true)
    await expect(repo.isAdmin("user1")).resolves.toBe(false)
  })

  it("fails closed for unknown users", async () => {
    await expect(repo.isAdmin("ghost")).resolves.toBe(false)
  })

  it("fails closed for null/undefined ids without querying", async () => {
    await expect(repo.isAdmin(null)).resolves.toBe(false)
    await expect(repo.isAdmin(undefined)).resolves.toBe(false)
  })
})
