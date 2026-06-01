import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type { ClientRequest } from "@modelcontextprotocol/sdk/types.js"

/**
 * Type for the makeRequest function passed as a prop to inspector components.
 *
 * Note: the actual implementation in useConnection.ts is generic over z.ZodType,
 * but useMemoizedFn (from ahooks) strips the generic type parameter. Since the
 * schema parameter is only used at runtime for parsing (the MCP Client handles
 * it), using `unknown` here is safe — the return type is determined by the
 * schema at runtime, not compile time.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type MakeRequestFn = (
  request: ClientRequest,
  schema: any,
  options?: RequestOptions & { suppressToast?: boolean },
) => Promise<any>
/* eslint-enable @typescript-eslint/no-explicit-any */
