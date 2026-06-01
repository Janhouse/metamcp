import type { AddressInfo } from "node:net"

import express from "express"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("../../db/repositories", () => ({
  oauthRepository: { upsertClient: vi.fn().mockResolvedValue(undefined) },
}))

import registrationRouter from "./registration"

let server: ReturnType<express.Express["listen"]>
let baseUrl: string
const APP_URL = "https://mcp.example.com"

beforeAll(async () => {
  process.env.APP_URL = APP_URL
  const app = express()
  app.use(express.json())
  app.use(registrationRouter)
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve)
  })
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  delete process.env.APP_URL
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe("DCR /oauth/register base URL (upstream #263/#195)", () => {
  it("derives endpoint URLs from APP_URL, not the request Host", async () => {
    const res = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      // Spoof a Host header to prove it is NOT used for the endpoint URLs.
      headers: { "Content-Type": "application/json", Host: "evil.example" },
      body: JSON.stringify({
        redirect_uris: ["https://app.example.com/cb"],
        token_endpoint_auth_method: "none",
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, string>
    expect(body.authorization_endpoint).toBe(`${APP_URL}/oauth/authorize`)
    expect(body.token_endpoint).toBe(`${APP_URL}/oauth/token`)
    // Never leak the request host / 127.0.0.1
    expect(JSON.stringify(body)).not.toContain("127.0.0.1")
    expect(JSON.stringify(body)).not.toContain("evil.example")
  })
})
