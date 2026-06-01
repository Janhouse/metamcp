/**
 * Shared utility for parsing MetaMCP tool names
 *
 * Tool names follow the format: {ServerPrefix}__{toolName}
 * Where ServerPrefix can be nested: Parent__Child__GrandChild
 * The first __ is always the separator between the top-level server prefix and the forwarded tool name
 */

export interface ParsedToolName {
  serverName: string
  originalToolName: string
}

/**
 * Parse a MetaMCP tool name into server prefix and tool name components
 *
 * @param toolName - Full tool name (e.g., "Server__tool" or "Parent__Child__tool")
 * @returns Parsed components or null if invalid format
 *
 * @example
 * parseToolName("Hacker-News__get_stories")
 * // → { serverName: "Hacker-News", originalToolName: "get_stories" }
 *
 * @example
 * parseToolName("Parent__Child__my_tool")
 * // → { serverName: "Parent", originalToolName: "Child__my_tool" }
 */
export function parseToolName(toolName: string): ParsedToolName | null {
  const firstDoubleUnderscoreIndex = toolName.indexOf("__")
  if (firstDoubleUnderscoreIndex === -1) {
    return null
  }

  // The first __ is always the separator between the top-level server prefix and the forwarded tool name
  // Everything before the first __ is the server prefix (which may contain nested servers)
  // Everything after the first __ is the forwarded tool name (which may itself include additional prefixes)
  const serverName = toolName.substring(0, firstDoubleUnderscoreIndex)
  const originalToolName = toolName.substring(firstDoubleUnderscoreIndex + 2)

  return {
    serverName,
    originalToolName,
  }
}

/**
 * Create a tool name from server prefix and tool name
 *
 * @param serverName - Server prefix (can be nested like "Parent__Child")
 * @param toolName - Tool name
 * @returns Full tool name
 *
 * @example
 * createToolName("Hacker-News", "get_stories")
 * // → "Hacker-News__get_stories"
 */
const MAX_TOOL_NAME_LENGTH = 64

export function createToolName(serverName: string, toolName: string): string {
  const fullName = `${serverName}__${toolName}`
  if (fullName.length <= MAX_TOOL_NAME_LENGTH) {
    return fullName
  }

  // Truncate the server prefix to fit, keeping the tool name intact
  const overhead = 2 // "__" separator
  const maxPrefixLength = MAX_TOOL_NAME_LENGTH - toolName.length - overhead
  if (maxPrefixLength >= 1) {
    return `${serverName.substring(0, maxPrefixLength)}__${toolName}`
  }

  // Tool name itself is too long — truncate the full name
  return fullName.substring(0, MAX_TOOL_NAME_LENGTH)
}
