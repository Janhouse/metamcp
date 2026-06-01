import type { McpServer } from "@repo/zod-types"

/**
 * Minimal endpoint shape needed to resolve an auto-generated endpoint server to
 * its namespace. Satisfied by `EndpointWithNamespace` from the endpoints list.
 */
export interface EndpointRef {
  name: string
  namespace_uuid: string
}

/**
 * If `server` is the auto-generated MCP server that backs a MetaMCP endpoint
 * (a STREAMABLE_HTTP server pointing at `${APP_URL}/metamcp/<name>/mcp`),
 * return the UUID of the namespace that endpoint aggregates. Otherwise null.
 *
 * Why this matters: those auto-generated servers point at the endpoint's own
 * public URL, which is gated by the endpoint's API-key/OAuth auth. A statically
 * stored bearer token frequently cannot satisfy it (OAuth-only endpoints store
 * no usable token; rotated API keys go stale), so inspecting the server fails
 * with a connection/401 error. Instead, inspection should connect to the
 * underlying namespace through the authenticated metamcp proxy
 * (`/mcp-proxy/metamcp/<namespace>/sse`), which uses the logged-in session and
 * enforces namespace access — yielding the same aggregated tool set.
 */
export function resolveEndpointNamespaceUuid(
  server: Pick<McpServer, "type" | "url"> | null | undefined,
  endpoints: EndpointRef[] | undefined,
): string | null {
  if (
    !server ||
    !endpoints ||
    server.type !== "STREAMABLE_HTTP" ||
    !server.url
  ) {
    return null
  }

  let pathname: string
  try {
    pathname = new URL(server.url).pathname
  } catch {
    return null
  }

  // Match the endpoint URL shape `/metamcp/<name>/mcp` (or `/sse`).
  const match = pathname.match(/\/metamcp\/([^/]+)\/(?:mcp|sse)\/?$/)
  const encodedName = match?.[1]
  if (!encodedName) {
    return null
  }

  const endpointName = decodeURIComponent(encodedName)
  const endpoint = endpoints.find((e) => e.name === endpointName)
  return endpoint?.namespace_uuid ?? null
}
