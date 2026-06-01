// Probe stdio server used by the sandbox integration tests. Speaks the same
// minimal newline-delimited JSON-RPC dialect as mock-stdio-server.mjs (and
// mirrors its stdin handling exactly), but exposes a few methods that let tests
// observe the sandbox from inside the spawned process:
//   ping        -> "pong"
//   echo-env    -> the child's process.env (to assert env scrubbing)
//   pid-info    -> { pid }  (a low pid proves PID-namespace isolation)
//   try-connect -> attempts a TCP connect (fails when egress is blocked)
//   alloc       -> allocates N MB in chunks (fails under an --as rlimit)
//
// Runtime-agnostic (plain ESM) so it runs under both Node and Bun.

import net from "node:net"

let buffer = ""

// Keep allocations referenced so they are not garbage-collected mid-test.
const allocations = []

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handle(msg) {
  // Notifications have no id and expect no response.
  if (msg.id === undefined || msg.id === null) return

  switch (msg.method) {
    case "ping":
      // result MUST be an object — the SDK's JSONRPCMessageSchema (used by the
      // transport's ReadBuffer) rejects a bare string result.
      send({ jsonrpc: "2.0", id: msg.id, result: { pong: true } })
      break
    case "echo-env":
      send({ jsonrpc: "2.0", id: msg.id, result: { env: process.env } })
      break
    case "pid-info":
      send({ jsonrpc: "2.0", id: msg.id, result: { pid: process.pid } })
      break
    case "try-connect":
      tryConnect(msg)
      break
    case "alloc":
      doAlloc(msg)
      break
    default:
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      })
  }
}

function tryConnect(msg) {
  const { host = "1.1.1.1", port = 443, timeoutMs = 1500 } = msg.params || {}
  let settled = false
  const finish = (result) => {
    if (settled) return
    settled = true
    try {
      socket.destroy()
    } catch {
      // ignore
    }
    send({ jsonrpc: "2.0", id: msg.id, result })
  }

  const socket = net.connect({ host, port })
  socket.setTimeout(timeoutMs)
  socket.on("connect", () => finish({ connected: true }))
  socket.on("timeout", () => finish({ connected: false, error: "timeout" }))
  socket.on("error", (err) =>
    finish({ connected: false, error: err.code || String(err) }),
  )
}

function doAlloc(msg) {
  const { mb = 4096, chunkMb = 128 } = msg.params || {}
  const chunkBytes = chunkMb * 1024 * 1024
  let allocated = 0
  try {
    while (allocated < mb) {
      // allocUnsafe -> a real mmap; cumulative virtual size trips `--as`.
      const buf = Buffer.allocUnsafe(chunkBytes)
      // Touch a byte so the allocation is not purely lazy.
      buf[0] = 1
      allocations.push(buf)
      allocated += chunkMb
    }
    send({ jsonrpc: "2.0", id: msg.id, result: { ok: true, allocated } })
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { ok: false, allocated, error: err.message || String(err) },
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
