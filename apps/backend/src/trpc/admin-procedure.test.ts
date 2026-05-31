import { adminProcedure, router } from "@repo/trpc"
import { TRPCError } from "@trpc/server"
import { describe, expect, it } from "vitest"

// A minimal router that exposes a single admin-only endpoint so we can exercise
// the adminProcedure middleware in isolation via createCaller.
const testRouter = router({
  adminOnly: adminProcedure.query(() => "secret"),
})

const session = { id: "sess", userId: "u1" }

function call(ctx: unknown) {
  // ctx shape matches BaseContext { user, session }
  return testRouter.createCaller(ctx as never).adminOnly()
}

describe("adminProcedure", () => {
  it("allows users with the admin role", async () => {
    await expect(
      call({ user: { id: "u1", role: "admin" }, session }),
    ).resolves.toBe("secret")
  })

  it("rejects authenticated non-admin users with FORBIDDEN", async () => {
    await expect(
      call({ user: { id: "u1", role: "user" }, session }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("fails closed when the role is missing/unknown", async () => {
    await expect(call({ user: { id: "u1" }, session })).rejects.toBeInstanceOf(
      TRPCError,
    )
  })

  it("rejects unauthenticated requests with UNAUTHORIZED", async () => {
    await expect(call({})).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })
})
