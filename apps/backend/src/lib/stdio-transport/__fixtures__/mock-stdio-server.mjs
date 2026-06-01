// Minimal newline-delimited JSON-RPC stdio server used by
// process-managed-transport.test.ts to exercise spawning + stdio framing +
// shutdown without depending on a real (network-fetched) MCP server.
//
// Runtime-agnostic (plain ESM, only process.stdin/stdout) so it runs under
// both Node and Bun.

let buffer = ""

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handle(msg) {
  // Notifications have no id and expect no response.
  if (msg.id === undefined || msg.id === null) return

  switch (msg.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-stdio-server", version: "0.0.1" },
        },
      })
      break
    case "tools/list":
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: [
            {
              name: "echo",
              description: "Echoes back the provided text",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          ],
        },
      })
      break
    case "tools/call":
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            { type: "text", text: String(msg.params?.arguments?.text ?? "") },
          ],
        },
      })
      break
    case "ping":
      send({ jsonrpc: "2.0", id: msg.id, result: {} })
      break
    default:
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      })
  }
}

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let index = buffer.indexOf("\n")
  while (index !== -1) {
    const line = buffer.slice(0, index).replace(/\r$/, "")
    buffer = buffer.slice(index + 1)
    if (line.trim()) {
      try {
        handle(JSON.parse(line))
      } catch {
        // ignore malformed lines
      }
    }
    index = buffer.indexOf("\n")
  }
})

// Keep the process alive until stdin closes or we are killed.
process.stdin.resume()
