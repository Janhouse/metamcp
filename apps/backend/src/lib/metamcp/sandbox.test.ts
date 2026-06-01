import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildChildEnv,
  getGlobalSandboxDefaults,
  getSandboxCwd,
  type ResolvedSandboxConfig,
  resolveSandboxConfig,
  wrapCommand,
} from "./sandbox"

// Environment variables this suite mutates — saved and restored around each
// test so global state never leaks between cases.
const MANAGED_ENV = [
  "MCP_SANDBOX",
  "MCP_SANDBOX_ALLOW_NETWORK",
  "MCP_SANDBOX_READONLY_ROOT",
  "MCP_SANDBOX_WORKDIR",
  "MCP_LIMIT_MEMORY_MB",
  "MCP_LIMIT_CPU_SEC",
  "MCP_LIMIT_NPROC",
  "MCP_LIMIT_NOFILE",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "SANDBOX_TEST_REF",
  "SANDBOX_TEST_UNLISTED",
]

let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = {}
  for (const key of MANAGED_ENV) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of MANAGED_ENV) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
})

// Tool fixtures hold the resolved command (bare names here keep the
// assertions readable; in production these are absolute paths).
const BOTH_TOOLS = { prlimit: "prlimit", bwrap: "bwrap" }

const baseCfg = (
  overrides: Partial<ResolvedSandboxConfig> = {},
): ResolvedSandboxConfig => ({
  mode: "none",
  network: true,
  readOnlyRoot: true,
  allowPaths: [],
  workDir: "/tmp/metamcp-mcp-test",
  limits: {},
  ...overrides,
})

describe("buildChildEnv", () => {
  it("never inherits non-whitelisted host secrets (deny-by-default)", () => {
    process.env.DATABASE_URL = "postgres://secret"
    process.env.BETTER_AUTH_SECRET = "super-secret"
    process.env.SANDBOX_TEST_UNLISTED = "should-be-dropped"

    const env = buildChildEnv()

    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.BETTER_AUTH_SECRET).toBeUndefined()
    expect(env.SANDBOX_TEST_UNLISTED).toBeUndefined()
  })

  it("inherits whitelisted vars like PATH", () => {
    // PATH is always present in the test environment.
    const env = buildChildEnv()
    expect(env.PATH).toBe(process.env.PATH)
  })

  it("passes explicitly-configured server env through", () => {
    const env = buildChildEnv({ MY_TOKEN: "abc123" })
    expect(env.MY_TOKEN).toBe("abc123")
  })

  it("resolves $-brace placeholders from the host env", () => {
    process.env.SANDBOX_TEST_REF = "resolved-value"
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal placeholder resolution
    const env = buildChildEnv({ FROM_REF: "${SANDBOX_TEST_REF}" })
    expect(env.FROM_REF).toBe("resolved-value")
  })

  it("does not let a configured var smuggle in a host secret it didn't ask for", () => {
    process.env.DATABASE_URL = "postgres://secret"
    const env = buildChildEnv({ HARMLESS: "ok" })
    expect(env.HARMLESS).toBe("ok")
    expect(env.DATABASE_URL).toBeUndefined()
  })
})

describe("wrapCommand", () => {
  it("returns the original command unchanged with mode:none and no limits", () => {
    const out = wrapCommand("node", ["server.js"], baseCfg(), BOTH_TOOLS)
    expect(out).toEqual({ command: "node", args: ["server.js"] })
  })

  it("prepends prlimit with the correct flags when limits are set", () => {
    const out = wrapCommand(
      "node",
      ["server.js"],
      baseCfg({
        limits: { memoryMb: 512, cpuSec: 10, nproc: 64, nofile: 256 },
      }),
      BOTH_TOOLS,
    )
    expect(out.command).toBe("prlimit")
    expect(out.args).toEqual([
      "--as=536870912",
      "--cpu=10",
      "--nproc=64",
      "--nofile=256",
      "--",
      "node",
      "server.js",
    ])
  })

  it("wraps with bwrap, with --unshare-net only when network is disabled", () => {
    const noNet = wrapCommand(
      "node",
      ["s.js"],
      baseCfg({ mode: "bwrap", network: false }),
      BOTH_TOOLS,
    )
    expect(noNet.command).toBe("bwrap")
    expect(noNet.args).toContain("--unshare-net")
    expect(noNet.args).toContain("--unshare-pid")
    // command + args land at the end, after the bwrap flags
    expect(noNet.args.slice(-2)).toEqual(["node", "s.js"])

    const withNet = wrapCommand(
      "node",
      ["s.js"],
      baseCfg({ mode: "bwrap", network: true }),
      BOTH_TOOLS,
    )
    expect(withNet.args).not.toContain("--unshare-net")
  })

  it("binds the root read-only when readOnlyRoot is true, read-write otherwise", () => {
    const ro = wrapCommand(
      "node",
      [],
      baseCfg({ mode: "bwrap", readOnlyRoot: true }),
      BOTH_TOOLS,
    )
    // "--ro-bind", "/", "/" appears as consecutive args
    const roIdx = ro.args.indexOf("--ro-bind")
    expect(roIdx).toBeGreaterThanOrEqual(0)
    expect(ro.args.slice(roIdx, roIdx + 3)).toEqual(["--ro-bind", "/", "/"])

    const rw = wrapCommand(
      "node",
      [],
      baseCfg({ mode: "bwrap", readOnlyRoot: false }),
      BOTH_TOOLS,
    )
    const bindRootIdx = rw.args.findIndex(
      (a, i) =>
        a === "--bind" && rw.args[i + 1] === "/" && rw.args[i + 2] === "/",
    )
    expect(bindRootIdx).toBeGreaterThanOrEqual(0)
  })

  it("re-binds toolchain cache dirs read-write under a read-only root", () => {
    // Snapshot + clear the toolchain env so the test exercises the documented
    // fallbacks ($HOME, $GOPATH->/go) deterministically regardless of host env.
    const snapshot: Record<string, string | undefined> = {}
    for (const key of [
      "HOME",
      "XDG_CACHE_HOME",
      "UV_CACHE_DIR",
      "npm_config_cache",
      "GOPATH",
      "GOCACHE",
      "GOMODCACHE",
    ]) {
      snapshot[key] = process.env[key]
      delete process.env[key]
    }
    process.env.HOME = "/home/sandbox-test-user"
    try {
      const ro = wrapCommand(
        "node",
        [],
        baseCfg({ mode: "bwrap", readOnlyRoot: true }),
        BOTH_TOOLS,
      )
      const join = ro.args.join(" ")
      // HOME (uv/npm caches) and the Go path are bound writable on top of the
      // read-only root so uvx/npx/go run can write their caches and lock files.
      expect(join).toContain(
        "--bind-try /home/sandbox-test-user /home/sandbox-test-user",
      )
      expect(join).toContain("--bind-try /go /go")
      // The root itself stays read-only.
      const roIdx = ro.args.indexOf("--ro-bind")
      expect(ro.args.slice(roIdx, roIdx + 3)).toEqual(["--ro-bind", "/", "/"])

      // With a writable root there is no need for the cache re-binds.
      const rw = wrapCommand(
        "node",
        [],
        baseCfg({ mode: "bwrap", readOnlyRoot: false }),
        BOTH_TOOLS,
      )
      expect(rw.args).not.toContain("--bind-try")
    } finally {
      for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  it("adds a --bind entry for each allowPath", () => {
    const out = wrapCommand(
      "node",
      [],
      baseCfg({ mode: "bwrap", allowPaths: ["/data/foo", "/data/bar"] }),
      BOTH_TOOLS,
    )
    const join = out.args.join(" ")
    expect(join).toContain("--bind /data/foo /data/foo")
    expect(join).toContain("--bind /data/bar /data/bar")
  })

  it("composes prlimit (outermost) then bwrap then the real command", () => {
    const out = wrapCommand(
      "node",
      ["s.js"],
      baseCfg({ mode: "bwrap", limits: { memoryMb: 256 } }),
      BOTH_TOOLS,
    )
    expect(out.command).toBe("prlimit")
    // prlimit flags, then "--", then bwrap, then bwrap flags ... node s.js
    expect(out.args[0]).toBe("--as=268435456")
    const sep = out.args.indexOf("--")
    expect(sep).toBeGreaterThan(0)
    expect(out.args[sep + 1]).toBe("bwrap")
    expect(out.args.slice(-2)).toEqual(["node", "s.js"])
  })

  it("falls back gracefully when requested tools are unavailable", () => {
    // bwrap requested but unavailable, no limits -> original command
    const noBwrap = wrapCommand("node", ["s.js"], baseCfg({ mode: "bwrap" }), {
      prlimit: "prlimit",
      bwrap: null,
    })
    expect(noBwrap).toEqual({ command: "node", args: ["s.js"] })

    // limits requested but prlimit unavailable -> original command
    const noPrlimit = wrapCommand(
      "node",
      ["s.js"],
      baseCfg({ limits: { memoryMb: 128 } }),
      { prlimit: null, bwrap: "bwrap" },
    )
    expect(noPrlimit).toEqual({ command: "node", args: ["s.js"] })
  })
})

describe("getGlobalSandboxDefaults / resolveSandboxConfig", () => {
  it("reads global defaults from environment variables", () => {
    process.env.MCP_SANDBOX = "bwrap"
    process.env.MCP_SANDBOX_ALLOW_NETWORK = "false"
    process.env.MCP_LIMIT_MEMORY_MB = "256"

    const g = getGlobalSandboxDefaults()
    expect(g.mode).toBe("bwrap")
    expect(g.network).toBe(false)
    expect(g.readOnlyRoot).toBe(true) // default
    expect(g.limits.memoryMb).toBe(256)
  })

  it("defaults to mode:none, network allowed, read-only root", () => {
    const g = getGlobalSandboxDefaults()
    expect(g.mode).toBe("none")
    expect(g.network).toBe(true)
    expect(g.readOnlyRoot).toBe(true)
    expect(g.limits).toEqual({})
  })

  it("merges per-server overrides over global defaults", () => {
    process.env.MCP_SANDBOX = "bwrap"
    process.env.MCP_SANDBOX_ALLOW_NETWORK = "false"
    process.env.MCP_LIMIT_MEMORY_MB = "256"

    const merged = resolveSandboxConfig({
      enabled: false, // forces mode none even though global is bwrap
      network: true, // overrides global false
      allowPaths: ["/srv/data"],
      limits: { cpuSec: 5 }, // memoryMb still inherits global 256
    })

    expect(merged.mode).toBe("none")
    expect(merged.network).toBe(true)
    expect(merged.allowPaths).toEqual(["/srv/data"])
    expect(merged.limits.cpuSec).toBe(5)
    expect(merged.limits.memoryMb).toBe(256)
  })

  it("returns global defaults when per-server config is null/undefined", () => {
    process.env.MCP_SANDBOX = "bwrap"
    const a = resolveSandboxConfig(null)
    const b = resolveSandboxConfig(undefined)
    expect(a.mode).toBe("bwrap")
    expect(b.mode).toBe("bwrap")
  })
})

describe("getSandboxCwd", () => {
  it("returns undefined when no sandbox layer is active", () => {
    expect(getSandboxCwd(baseCfg(), BOTH_TOOLS)).toBeUndefined()
  })

  it("returns the workDir when a sandbox layer is active", () => {
    const cwd = getSandboxCwd(baseCfg({ limits: { memoryMb: 64 } }), BOTH_TOOLS)
    expect(cwd).toBe("/tmp/metamcp-mcp-test")
  })
})
