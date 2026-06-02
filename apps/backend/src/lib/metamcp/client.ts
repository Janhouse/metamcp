import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { ServerParameters } from "@repo/zod-types"

import logger from "@/utils/logger"

import { ProcessManagedStdioTransport } from "../stdio-transport/process-managed-transport"
import { metamcpLogStore } from "./log-store"
import {
  buildChildEnv,
  getSandboxCwd,
  resolveSandboxConfig,
  wrapCommand,
} from "./sandbox"
import { serverErrorTracker } from "./server-error-tracker"

const sleep = (time: number) =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), time))

export interface ConnectedClient {
  client: Client
  cleanup: () => Promise<void>
  onProcessCrash?: (exitCode: number | null, signal: string | null) => void
  /**
   * OS pid of the spawned child process for STDIO servers, or null for
   * URL-based (SSE / STREAMABLE_HTTP) servers that spawn no local process.
   * Used for per-server memory reporting. For sandboxed servers this is the
   * wrapper pid (prlimit/bwrap) — the real server is a descendant, so memory
   * must be summed over the whole process tree rooted at this pid.
   */
  pid: number | null
}

/**
 * Transforms localhost URLs to use host.docker.internal when running inside Docker
 */
export const transformDockerUrl = (url: string): string => {
  if (process.env.TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL === "true") {
    const transformed = url.replace(
      /localhost|127\.0\.0\.1/g,
      "host.docker.internal",
    )
    return transformed
  }
  return url
}

export const createMetaMcpClient = (
  serverParams: ServerParameters,
): { client: Client | undefined; transport: Transport | undefined } => {
  let transport: Transport | undefined

  // Create the appropriate transport based on server type
  // Default to "STDIO" if type is undefined
  if (!serverParams.type || serverParams.type === "STDIO") {
    // Deny-by-default env (never inherits the full process.env) and optional
    // per-process resource/namespace sandboxing around the spawned server.
    const childEnv = buildChildEnv(serverParams.env)
    const sandboxCfg = resolveSandboxConfig(serverParams.sandbox)
    const wrapped = wrapCommand(
      serverParams.command || "",
      serverParams.args || [],
      sandboxCfg,
    )

    const stdioParams: StdioServerParameters = {
      command: wrapped.command,
      args: wrapped.args.length > 0 ? wrapped.args : undefined,
      env: childEnv,
      stderr: "pipe",
      cwd: getSandboxCwd(sandboxCfg),
    }
    transport = new ProcessManagedStdioTransport(stdioParams)

    // Handle stderr stream when set to "pipe"
    if ((transport as ProcessManagedStdioTransport).stderr) {
      const stderrStream = (transport as ProcessManagedStdioTransport).stderr

      stderrStream?.on("data", (chunk: Buffer) => {
        const message = chunk.toString().trim()
        // Detect log level from stderr content — MCP servers (especially
        // Python) write INFO/DEBUG messages to stderr by default
        const level = /\bERROR\b/i.test(message)
          ? "error"
          : /\bWARN(?:ING)?\b/i.test(message)
            ? "warn"
            : "info"
        metamcpLogStore.addLog(serverParams.name, level, message)
      })

      stderrStream?.on("error", (error: Error) => {
        metamcpLogStore.addLog(
          serverParams.name,
          "error",
          "stderr error",
          error,
        )
      })
    }
  } else if (serverParams.type === "SSE" && serverParams.url) {
    // Transform the URL if TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL is set to "true"
    const transformedUrl = transformDockerUrl(serverParams.url)

    // Build headers: start with custom headers, then add auth header
    const headers: Record<string, string> = {
      ...(serverParams.headers || {}),
    }

    // Check for authentication - prioritize OAuth tokens, fallback to bearerToken
    const authToken =
      serverParams.oauth_tokens?.access_token || serverParams.bearerToken
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`
    }

    const hasHeaders = Object.keys(headers).length > 0

    if (!hasHeaders) {
      transport = new SSEClientTransport(new URL(transformedUrl))
    } else {
      transport = new SSEClientTransport(new URL(transformedUrl), {
        requestInit: {
          headers,
        },
        eventSourceInit: {
          fetch: (url, init) => fetch(url, { ...init, headers }),
        },
      })
    }
  } else if (serverParams.type === "STREAMABLE_HTTP" && serverParams.url) {
    // Transform the URL if TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL is set to "true"
    const transformedUrl = transformDockerUrl(serverParams.url)

    // Build headers: start with custom headers, then add auth header
    const headers: Record<string, string> = {
      ...(serverParams.headers || {}),
    }

    // Check for authentication - prioritize OAuth tokens, fallback to bearerToken
    const authToken =
      serverParams.oauth_tokens?.access_token || serverParams.bearerToken
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`
    }

    const hasHeaders = Object.keys(headers).length > 0

    if (!hasHeaders) {
      transport = new StreamableHTTPClientTransport(new URL(transformedUrl))
    } else {
      transport = new StreamableHTTPClientTransport(new URL(transformedUrl), {
        requestInit: {
          headers,
        },
      })
    }
  } else {
    metamcpLogStore.addLog(
      serverParams.name,
      "error",
      `Unsupported server type: ${serverParams.type}`,
    )
    return { client: undefined, transport: undefined }
  }

  const client = new Client(
    {
      name: "metamcp-client",
      version: "2.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {},
      },
    },
  )
  return { client, transport }
}

export const connectMetaMcpClient = async (
  serverParams: ServerParameters,
  onProcessCrash?: (exitCode: number | null, signal: string | null) => void,
): Promise<ConnectedClient | undefined> => {
  const baseWaitMs = 2000
  const maxWaitMs = 15000

  // Get max attempts from server error tracker instead of hardcoding
  const maxAttempts = await serverErrorTracker.getServerMaxAttempts(
    serverParams.uuid,
  )
  let count = 0
  let retry = true

  logger.info(
    `Connecting to server ${serverParams.name} (${serverParams.uuid}) with max attempts: ${maxAttempts}`,
  )

  while (retry) {
    let transport: Transport | undefined
    let client: Client | undefined

    try {
      // Check if server is already in error state before attempting connection
      const isInErrorState = await serverErrorTracker.isServerInErrorState(
        serverParams.uuid,
      )
      if (isInErrorState) {
        logger.info(
          `Server ${serverParams.name} (${serverParams.uuid}) is already in ERROR state, skipping connection attempt`,
        )
        return undefined
      }

      // Create fresh client and transport for each attempt
      const result = createMetaMcpClient(serverParams)
      client = result.client
      transport = result.transport

      if (!client || !transport) {
        return undefined
      }

      // Set up process crash detection for STDIO transports BEFORE connecting
      if (transport instanceof ProcessManagedStdioTransport) {
        logger.info(
          `Setting up crash handler for server ${serverParams.name} (${serverParams.uuid})`,
        )
        transport.onprocesscrash = (exitCode, signal) => {
          logger.info(
            `Process crashed for server ${serverParams.name} (${serverParams.uuid}): code=${exitCode}, signal=${signal}`,
          )

          // Notify the pool about the crash
          if (onProcessCrash) {
            logger.info(
              `Calling onProcessCrash callback for server ${serverParams.name} (${serverParams.uuid})`,
            )
            onProcessCrash(exitCode, signal)
          } else {
            logger.info(
              `No onProcessCrash callback provided for server ${serverParams.name} (${serverParams.uuid})`,
            )
          }
        }
      }

      await client.connect(transport)

      // Auto-clear ERROR state on successful reconnection
      serverErrorTracker.resetServerAttempts(serverParams.uuid)
      if (await serverErrorTracker.isServerInErrorState(serverParams.uuid)) {
        await serverErrorTracker.resetServerErrorState(serverParams.uuid)
        logger.info(
          `Auto-cleared ERROR state for server ${serverParams.name} (${serverParams.uuid}) after successful connection`,
        )
      }

      const connectedTransport = transport
      const connectedClient = client
      return {
        client,
        pid:
          connectedTransport instanceof ProcessManagedStdioTransport
            ? connectedTransport.pid
            : null,
        cleanup: async () => {
          await connectedTransport.close()
          await connectedClient.close()
        },
        onProcessCrash: (exitCode, signal) => {
          logger.warn(
            `Process crash detected for server ${serverParams.name} (${serverParams.uuid}): code=${exitCode}, signal=${signal}`,
          )

          // Notify the pool about the crash
          if (onProcessCrash) {
            onProcessCrash(exitCode, signal)
          }
        },
      }
    } catch (error) {
      // Log connection failures as warnings for expected cases (401/404 from
      // external servers during warmup), errors only for unexpected failures
      const errorCode = (error as { code?: number })?.code
      const isExpected = errorCode === 401 || errorCode === 404
      metamcpLogStore.addLog(
        "client",
        isExpected ? "warn" : "error",
        `${isExpected ? "Cannot connect" : "Error connecting"} to MetaMCP client ${serverParams.name} (attempt ${count + 1}/${maxAttempts})${isExpected ? ` [${errorCode}]` : ""}`,
        isExpected ? undefined : error,
      )

      // CRITICAL FIX: Clean up transport/process on connection failure
      // This prevents orphaned processes from accumulating
      if (transport) {
        try {
          await transport.close()
          console.log(
            `Cleaned up transport for failed connection to ${serverParams.name} (${serverParams.uuid})`,
          )
        } catch (cleanupError) {
          console.error(
            `Error cleaning up transport for ${serverParams.name} (${serverParams.uuid}):`,
            cleanupError,
          )
        }
      }
      if (client) {
        try {
          await client.close()
        } catch (_cleanupError) {
          // Client may not be fully initialized, ignore
        }
      }

      count++
      retry = count < maxAttempts
      if (retry) {
        const waitFor = Math.min(baseWaitMs * 2 ** (count - 1), maxWaitMs)
        logger.info(
          `Retrying connection to ${serverParams.name} in ${waitFor}ms (attempt ${count}/${maxAttempts})`,
        )
        await sleep(waitFor)
      }
    }
  }

  return undefined
}
