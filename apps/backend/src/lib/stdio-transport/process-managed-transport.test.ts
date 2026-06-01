import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, describe, expect, it } from "vitest"

import {
  buildChildEnv,
  detectSandboxTools,
  getSandboxCwd,
  type ResolvedSandboxConfig,
  wrapCommand,
} from "../metamcp/sandbox"
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

// ---------------------------------------------------------------------------
// Sandbox wrapping (env scrub + prlimit + bwrap) end-to-end against a real
// spawned child. The prlimit/bwrap suites are skipped where the tools (or
// unprivileged user namespaces) are unavailable.
// ---------------------------------------------------------------------------

const PROBE = fileURLToPath(
  new URL("./__fixtures__/mcp-probe-server.mjs", import.meta.url),
)

const sandboxTools = detectSandboxTools()

interface RpcResponse {
  id?: unknown
  result?: unknown
  error?: unknown
}

function rpcCall(
  transport: ProcessManagedStdioTransport,
  msg: JSONRPCMessage,
  // Generous default: wrapping the child in prlimit/bwrap and cold-starting the
  // runtime can take several seconds inside the loaded vitest process.
  timeoutMs = 15000,
): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for response")),
      timeoutMs,
    )
    const id = (msg as { id?: unknown }).id
    const prev = transport.onmessage
    transport.onmessage = (incoming) => {
      if ((incoming as { id?: unknown }).id === id) {
        clearTimeout(timer)
        transport.onmessage = prev
        resolve(incoming as RpcResponse)
      }
    }
    transport.send(msg).catch(reject)
  })
}

function sandboxCfg(
  overrides: Partial<ResolvedSandboxConfig> = {},
): ResolvedSandboxConfig {
  return {
    mode: "none",
    network: true,
    readOnlyRoot: true,
    allowPaths: [],
    workDir: join(tmpdir(), "metamcp-mcp-e2e"),
    limits: {},
    ...overrides,
  }
}

function spawnProbe(
  cfg: ResolvedSandboxConfig,
  env?: Record<string, string>,
): ProcessManagedStdioTransport {
  const wrapped = wrapCommand(process.execPath, [PROBE], cfg)
  return new ProcessManagedStdioTransport({
    command: wrapped.command,
    args: wrapped.args,
    env,
    stderr: "pipe",
    cwd: getSandboxCwd(cfg),
  })
}

describe("ProcessManagedStdioTransport sandbox wrapping", () => {
  let transport: ProcessManagedStdioTransport | undefined

  afterEach(async () => {
    await transport?.close()
    transport = undefined
  })

  it("scrubs host secrets from the child env (deny-by-default)", async () => {
    process.env.SANDBOX_E2E_SECRET = "should-not-leak"
    try {
      const env = buildChildEnv({ SANDBOX_E2E_CONFIGURED: "present" })
      transport = spawnProbe(sandboxCfg(), env)
      await transport.start()

      const res = await rpcCall(transport, {
        jsonrpc: "2.0",
        id: 1,
        method: "echo-env",
      })
      const childEnv = (res.result as { env: Record<string, string> }).env

      expect(childEnv.SANDBOX_E2E_SECRET).toBeUndefined()
      expect(childEnv.SANDBOX_E2E_CONFIGURED).toBe("present")
      // A whitelisted var is still inherited.
      expect(childEnv.PATH).toBeTruthy()
    } finally {
      delete process.env.SANDBOX_E2E_SECRET
    }
  })

  describe.skipIf(!sandboxTools.prlimit)("with prlimit", () => {
    it("runs the wrapped command and tears down cleanly", async () => {
      transport = spawnProbe(sandboxCfg({ limits: { nofile: 4096 } }))
      await transport.start()
      const pid = transport.pid
      expect(pid).toBeTruthy()

      const res = await rpcCall(transport, {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      })
      expect((res.result as { pong: boolean }).pong).toBe(true)

      await transport.close()
      transport = undefined
      await new Promise((r) => setTimeout(r, 500))
      expect(isAlive(pid as number)).toBe(false)
    }, 20000)

    it("kills/fails a process that allocates beyond the memory limit", async () => {
      // The limit must be high enough for the runtime itself to start (node
      // reserves ~1.5 GB of virtual address space) but far below the
      // allocation the probe attempts, so the over-allocation trips `--as`.
      transport = spawnProbe(sandboxCfg({ limits: { memoryMb: 2048 } }))
      await transport.start()

      let okFalse = false
      let crashed = false
      try {
        const res = await rpcCall(
          transport,
          {
            jsonrpc: "2.0",
            id: 1,
            method: "alloc",
            params: { mb: 6144, chunkMb: 256 },
          },
          18000,
        )
        okFalse = (res.result as { ok: boolean }).ok === false
      } catch {
        // process crashed / response never came — the limit did its job
        crashed = true
      }
      expect(okFalse || crashed).toBe(true)
    }, 20000)
  })

  describe.skipIf(!sandboxTools.bwrap)("with bwrap", () => {
    it("isolates the PID namespace and still works", async () => {
      transport = spawnProbe(sandboxCfg({ mode: "bwrap", network: true }))
      await transport.start()

      const ping = await rpcCall(transport, {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      })
      expect((ping.result as { pong: boolean }).pong).toBe(true)

      const info = await rpcCall(transport, {
        jsonrpc: "2.0",
        id: 2,
        method: "pid-info",
      })
      // Inside a fresh PID namespace the child sees a very low pid (1 or 2),
      // never a real host pid.
      expect((info.result as { pid: number }).pid).toBeLessThanOrEqual(10)
    }, 20000)

    it("blocks network egress when network is disabled", async () => {
      transport = spawnProbe(sandboxCfg({ mode: "bwrap", network: false }))
      await transport.start()

      const res = await rpcCall(
        transport,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "try-connect",
          params: { host: "1.1.1.1", port: 443, timeoutMs: 2000 },
        },
        8000,
      )
      expect((res.result as { connected: boolean }).connected).toBe(false)
    }, 20000)
  })
})
