import { fileURLToPath } from "node:url"

import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, describe, expect, it } from "vitest"

import { ProcessManagedStdioTransport } from "./process-managed-transport"

const FIXTURE = fileURLToPath(
  new URL("./__fixtures__/mock-stdio-server.mjs", import.meta.url),
)

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Exercises the real spawn → stdio-framing → shutdown path the MCP proxy uses
 * for STDIO servers. Validates that child processes can be spawned and talked
 * to, and that close() tears down the process group (no orphans). This is the
 * machinery that had to keep working through the Node→Bun runtime migration.
 */
describe("ProcessManagedStdioTransport", () => {
  let transport: ProcessManagedStdioTransport | undefined

  afterEach(async () => {
    await transport?.close()
    transport = undefined
  })

  function makeTransport() {
    // Spawn the fixture with the same runtime that's executing the tests.
    return new ProcessManagedStdioTransport({
      command: process.execPath,
      args: [FIXTURE],
      stderr: "pipe",
    })
  }

  function rpc(transport: ProcessManagedStdioTransport, msg: JSONRPCMessage) {
    return new Promise<JSONRPCMessage>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for response")),
        5000,
      )
      const id = (msg as { id?: unknown }).id
      const prev = transport.onmessage
      transport.onmessage = (incoming) => {
        if ((incoming as { id?: unknown }).id === id) {
          clearTimeout(timer)
          transport.onmessage = prev
          resolve(incoming)
        }
      }
      transport.send(msg).catch(reject)
    })
  }

  it("spawns a child process and round-trips JSON-RPC over stdio", async () => {
    transport = makeTransport()
    await transport.start()

    expect(typeof transport.pid).toBe("number")
    expect(transport.pid).toBeGreaterThan(0)

    const initResult = await rpc(transport, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    })
    expect(initResult).toMatchObject({
      id: 1,
      result: { serverInfo: { name: "mock-stdio-server" } },
    })

    const tools = await rpc(transport, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })
    expect(tools).toMatchObject({
      id: 2,
      result: { tools: [{ name: "echo" }] },
    })

    const call = await rpc(transport, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello-bun" } },
    })
    expect(call).toMatchObject({
      id: 3,
      result: { content: [{ type: "text", text: "hello-bun" }] },
    })
  })

  it("terminates the child process group on close()", async () => {
    transport = makeTransport()
    await transport.start()
    const pid = transport.pid
    expect(pid).toBeTruthy()
    expect(isAlive(pid as number)).toBe(true)

    await transport.close()
    transport = undefined

    // Give the OS a moment to reap the process.
    await new Promise((r) => setTimeout(r, 500))
    expect(isAlive(pid as number)).toBe(false)
  })
})
