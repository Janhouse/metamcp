import { createConfigRouter } from "@repo/trpc"
import { describe, expect, it, vi } from "vitest"

// Stub config implementations; we only care about whether the procedure-level
// authorization lets the call through to them.
const setSignupDisabled = vi.fn().mockResolvedValue({ success: true })
const getSignupDisabled = vi.fn().mockResolvedValue(false)

const implementations = {
  getSignupDisabled,
  setSignupDisabled,
  getSsoSignupDisabled: vi.fn().mockResolvedValue(false),
  setSsoSignupDisabled: vi.fn().mockResolvedValue({ success: true }),
  getBasicAuthDisabled: vi.fn().mockResolvedValue(false),
  setBasicAuthDisabled: vi.fn().mockResolvedValue({ success: true }),
  getMcpResetTimeoutOnProgress: vi.fn().mockResolvedValue(false),
  setMcpResetTimeoutOnProgress: vi.fn().mockResolvedValue({ success: true }),
  getMcpTimeout: vi.fn().mockResolvedValue(60000),
  setMcpTimeout: vi.fn().mockResolvedValue({ success: true }),
  getMcpMaxTotalTimeout: vi.fn().mockResolvedValue(60000),
  setMcpMaxTotalTimeout: vi.fn().mockResolvedValue({ success: true }),
  getMcpMaxAttempts: vi.fn().mockResolvedValue(1),
  setMcpMaxAttempts: vi.fn().mockResolvedValue({ success: true }),
  getSessionLifetime: vi.fn().mockResolvedValue(null),
  setSessionLifetime: vi.fn().mockResolvedValue({ success: true }),
  getAllConfigs: vi.fn().mockResolvedValue([]),
  setConfig: vi.fn().mockResolvedValue({ success: true }),
  getAuthProviders: vi.fn().mockResolvedValue([]),
} as any

const configRouter = createConfigRouter(implementations)
const session = { id: "s", userId: "u1" }

describe("config router authorization", () => {
  it("lets anyone read getSignupDisabled (public)", async () => {
    const caller = configRouter.createCaller({ session } as never)
    await expect(caller.getSignupDisabled()).resolves.toBe(false)
  })

  it("blocks a non-admin from changing app-wide config", async () => {
    const caller = configRouter.createCaller({
      user: { id: "u1", role: "user" },
      session,
    } as never)
    await expect(
      caller.setSignupDisabled({ disabled: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(setSignupDisabled).not.toHaveBeenCalled()
  })

  it("blocks unauthenticated config writes", async () => {
    const caller = configRouter.createCaller({} as never)
    await expect(
      caller.setBasicAuthDisabled({ disabled: true }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })

  it("allows an admin to change app-wide config", async () => {
    const caller = configRouter.createCaller({
      user: { id: "admin", role: "admin" },
      session,
    } as never)
    await expect(caller.setSignupDisabled({ disabled: true })).resolves.toEqual(
      { success: true },
    )
    expect(setSignupDisabled).toHaveBeenCalledWith({ disabled: true })
  })
})
