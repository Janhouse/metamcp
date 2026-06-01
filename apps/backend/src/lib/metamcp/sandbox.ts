import { execFileSync } from "node:child_process"
import { accessSync, constants as fsConstants, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import type { SandboxConfig } from "@repo/zod-types"

import logger from "@/utils/logger"

// ---------------------------------------------------------------------------
// Environment scrubbing (single source of truth for the spawn environment)
// ---------------------------------------------------------------------------

/**
 * Environment variables that are safe to inherit by default when spawning an
 * MCP server. This is the canonical list — `utils.ts` re-exports these so the
 * older import sites keep working. Deny-by-default: anything not on this list
 * and not explicitly configured per server is dropped (never inherited), which
 * removes the leak of `DATABASE_URL`/`BETTER_AUTH_SECRET`/etc. into child
 * processes.
 */
export const DEFAULT_INHERITED_ENV_VARS =
  process.platform === "win32"
    ? [
        "APPDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "LOCALAPPDATA",
        "PATH",
        "PROCESSOR_ARCHITECTURE",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TEMP",
        "USERNAME",
        "USERPROFILE",
      ]
    : /* list inspired by the default env inheritance of sudo */
      [
        "HOME",
        "LOGNAME",
        "PATH",
        "SHELL",
        "TERM",
        "USER",
        // SSL/Certificate variables for corporate proxies and custom CA certificates
        "NODE_EXTRA_CA_CERTS",
        "NODE_TLS_REJECT_UNAUTHORIZED",
        "SSL_CERT_FILE",
        "CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "REQUESTS_CERT_FILE",
        "CURL_CA_BUNDLE",
        "PIP_CERT",
        "UV_CERT",
        "PYTHONHTTPSVERIFY",
        // Proxy variables
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
      ]

/**
 * Returns a default environment object including only environment variables
 * deemed safe to inherit (the `DEFAULT_INHERITED_ENV_VARS` whitelist).
 */
export function getDefaultEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}

  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = process.env[key]
    if (value === undefined) {
      continue
    }

    if (value.startsWith("()")) {
      // Skip functions, which are a security risk.
      continue
    }

    env[key] = value
  }

  return env
}

/**
 * Resolves environment variable placeholders in an environment object.
 * Replaces values like "${VAR_NAME}" with the actual environment variable value.
 */
export function resolveEnvVariables(
  envObject: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(envObject)) {
    if (
      typeof value === "string" &&
      value.startsWith("${") &&
      value.endsWith("}")
    ) {
      const varName = value.slice(2, -1)
      if (process.env[varName]) {
        resolved[key] = process.env[varName]
        logger.info(
          `Resolved environment variable: ${key}=${value} -> ${varName}=[REDACTED]`,
        )
      } else {
        resolved[key] = value // Keep original value if env var not found
        logger.warn(
          `Environment variable not found: ${varName}, keeping original value: ${value}`,
        )
      }
    } else {
      resolved[key] = value
    }
  }

  return resolved
}

/**
 * Build the environment for a spawned STDIO MCP server.
 *
 * Deny-by-default: starts from the inherit whitelist (never the full
 * `process.env`) and layers the server's explicitly-configured env on top,
 * resolving `${VAR}` placeholders. This is the single env builder used by both
 * spawn paths (the pool path in `client.ts` and the MCP-Inspector path in
 * `mcp-proxy/server.ts`).
 */
export function buildChildEnv(
  serverEnv?: Record<string, string> | null,
): Record<string, string> {
  const env = getDefaultEnvironment()

  if (serverEnv) {
    const resolved = resolveEnvVariables(serverEnv)
    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === "string") {
        env[key] = value
      }
    }
  }

  return env
}

// ---------------------------------------------------------------------------
// Sandbox configuration
// ---------------------------------------------------------------------------

export type SandboxMode = "none" | "bwrap"

export interface ResolvedSandboxLimits {
  memoryMb?: number
  cpuSec?: number
  nproc?: number
  nofile?: number
}

export interface ResolvedSandboxConfig {
  mode: SandboxMode
  network: boolean
  readOnlyRoot: boolean
  allowPaths: string[]
  workDir: string
  limits: ResolvedSandboxLimits
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  return defaultValue
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined
  const n = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

/**
 * Global sandbox defaults derived from environment variables. Read fresh on
 * each call (env does not change at runtime, and reading fresh lets tests
 * mutate `process.env`).
 */
export function getGlobalSandboxDefaults(): ResolvedSandboxConfig {
  const mode: SandboxMode =
    (process.env.MCP_SANDBOX ?? "none").trim().toLowerCase() === "bwrap"
      ? "bwrap"
      : "none"

  return {
    mode,
    // Most MCP servers need network access, so default to allowed.
    network: parseBool(process.env.MCP_SANDBOX_ALLOW_NETWORK, true),
    readOnlyRoot: parseBool(process.env.MCP_SANDBOX_READONLY_ROOT, true),
    allowPaths: [],
    workDir:
      process.env.MCP_SANDBOX_WORKDIR?.trim() ||
      path.join(os.tmpdir(), "metamcp-mcp"),
    limits: {
      memoryMb: parsePositiveInt(process.env.MCP_LIMIT_MEMORY_MB),
      cpuSec: parsePositiveInt(process.env.MCP_LIMIT_CPU_SEC),
      nproc: parsePositiveInt(process.env.MCP_LIMIT_NPROC),
      nofile: parsePositiveInt(process.env.MCP_LIMIT_NOFILE),
    },
  }
}

/**
 * Merge global defaults with per-server overrides. Per-server fields win when
 * set; unset fields inherit the global default. A `null`/`undefined` per-server
 * config means "use global defaults for everything".
 */
export function resolveSandboxConfig(
  perServer?: SandboxConfig | null,
): ResolvedSandboxConfig {
  const globals = getGlobalSandboxDefaults()
  if (!perServer) return globals

  const mode: SandboxMode =
    perServer.enabled === undefined
      ? globals.mode
      : perServer.enabled
        ? "bwrap"
        : "none"

  return {
    mode,
    network: perServer.network ?? globals.network,
    readOnlyRoot: perServer.readOnlyRoot ?? globals.readOnlyRoot,
    allowPaths:
      perServer.allowPaths && perServer.allowPaths.length > 0
        ? perServer.allowPaths
        : globals.allowPaths,
    workDir: globals.workDir,
    limits: {
      memoryMb: perServer.limits?.memoryMb ?? globals.limits.memoryMb,
      cpuSec: perServer.limits?.cpuSec ?? globals.limits.cpuSec,
      nproc: perServer.limits?.nproc ?? globals.limits.nproc,
      nofile: perServer.limits?.nofile ?? globals.limits.nofile,
    },
  }
}

export function hasResourceLimits(cfg: ResolvedSandboxConfig): boolean {
  const { memoryMb, cpuSec, nproc, nofile } = cfg.limits
  return Boolean(memoryMb || cpuSec || nproc || nofile)
}

// ---------------------------------------------------------------------------
// Tool detection (probe once, cache)
// ---------------------------------------------------------------------------

export interface SandboxTools {
  /** Resolved absolute path to `prlimit`, or null if unavailable. */
  prlimit: string | null
  /** Resolved absolute path to a functional `bwrap`, or null if unavailable. */
  bwrap: string | null
}

let toolCache: SandboxTools | undefined

function probe(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore", timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve an executable to an absolute path by scanning `PATH` plus the
 * standard sbin/bin directories (prlimit/bwrap live in /usr/sbin on some
 * distros, which is not always on a scrubbed PATH). Returns null if not found.
 *
 * Using an absolute path at spawn time is important: the child is launched with
 * a deny-by-default env, and some runtimes resolve a bare command name against
 * the *child's* PATH rather than the parent's — so a bare "prlimit"/"bwrap" can
 * fail with ENOENT even when the binary is on the app's PATH.
 */
function resolveExecutable(name: string): string | null {
  if (process.platform === "win32") {
    // Spawning these sandbox tools is a POSIX-only concern.
    return null
  }
  const pathDirs = (process.env.PATH || "").split(path.delimiter)
  const extraDirs = [
    "/usr/sbin",
    "/sbin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
  ]
  for (const dir of [...pathDirs, ...extraDirs]) {
    if (!dir) continue
    const full = path.join(dir, name)
    try {
      accessSync(full, fsConstants.X_OK)
      return full
    } catch {
      // not executable / not here
    }
  }
  return null
}

/**
 * Probe for `prlimit` and a *functional* `bwrap` (unprivileged user namespaces
 * must actually work, not just the binary exist), resolving each to an absolute
 * path. Cached after the first call.
 */
export function detectSandboxTools(): SandboxTools {
  if (toolCache) return toolCache

  const prlimitPath = resolveExecutable("prlimit")
  const prlimit =
    prlimitPath && probe(prlimitPath, ["--version"]) ? prlimitPath : null

  const bwrapPath = resolveExecutable("bwrap")
  let bwrap: string | null = null
  if (bwrapPath && probe(bwrapPath, ["--version"])) {
    // Functional test: unprivileged userns + namespace creation must succeed.
    if (probe(bwrapPath, ["--ro-bind", "/", "/", "--unshare-pid", "true"])) {
      bwrap = bwrapPath
    }
  }

  toolCache = { prlimit, bwrap }

  if (!prlimit) {
    logger.warn(
      "prlimit not available — MCP resource limits (MCP_LIMIT_*) will be ignored",
    )
  }
  if (!bwrap) {
    logger.warn(
      "bubblewrap (functional unprivileged userns) not available — MCP_SANDBOX=bwrap will fall back to limits-only",
    )
  }

  return toolCache
}

/** Reset the cached tool-detection result (test helper). */
export function resetSandboxToolCache(): void {
  toolCache = undefined
}

function ensureWorkDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error) {
    logger.warn(`Failed to create sandbox workDir ${dir}:`, error)
  }
}

/**
 * Whether any sandboxing layer is actually active (and available) for this
 * config — used to decide whether to point the child's cwd at the scratch
 * workDir.
 */
function isSandboxActive(
  cfg: ResolvedSandboxConfig,
  tools: SandboxTools,
): boolean {
  return (
    (cfg.mode === "bwrap" && tools.bwrap) ||
    (hasResourceLimits(cfg) && tools.prlimit)
  )
}

/**
 * The working directory to spawn the child in. Returns the scratch workDir
 * (ensuring it exists) when sandboxing is active, otherwise `undefined` so
 * non-sandboxed servers keep inheriting the app's cwd (no behavior change).
 */
export function getSandboxCwd(
  cfg: ResolvedSandboxConfig,
  tools: SandboxTools = detectSandboxTools(),
): string | undefined {
  if (!isSandboxActive(cfg, tools)) return undefined
  ensureWorkDir(cfg.workDir)
  return cfg.workDir
}

// ---------------------------------------------------------------------------
// Command wrapping
// ---------------------------------------------------------------------------

function buildBwrapArgs(cfg: ResolvedSandboxConfig): string[] {
  const args: string[] = [
    "--die-with-parent",
    "--new-session",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
  ]

  if (!cfg.network) {
    args.push("--unshare-net")
  }

  // Bind the whole root filesystem (read-only by default) so the toolchains
  // MCP servers rely on (node/npx, bun, uv/uvx, go) remain visible, then
  // overlay fresh /proc, /dev and a writable /tmp on top.
  args.push(cfg.readOnlyRoot ? "--ro-bind" : "--bind", "/", "/")
  args.push("--proc", "/proc")
  args.push("--dev", "/dev")
  args.push("--tmpfs", "/tmp")

  // Writable scratch dir + make it the working directory.
  ensureWorkDir(cfg.workDir)
  args.push("--bind", cfg.workDir, cfg.workDir)
  args.push("--chdir", cfg.workDir)

  // Extra explicitly-allowed paths are bound read-write (e.g. for filesystem
  // MCP servers that need a specific directory).
  for (const p of cfg.allowPaths) {
    if (p && p.trim() !== "") {
      args.push("--bind", p, p)
    }
  }

  return args
}

function buildPrlimitArgs(limits: ResolvedSandboxLimits): string[] {
  const args: string[] = []
  if (limits.memoryMb) {
    // --as is the address-space (virtual memory) limit, in bytes.
    args.push(`--as=${limits.memoryMb * 1024 * 1024}`)
  }
  if (limits.cpuSec) {
    args.push(`--cpu=${limits.cpuSec}`)
  }
  if (limits.nproc) {
    args.push(`--nproc=${limits.nproc}`)
  }
  if (limits.nofile) {
    args.push(`--nofile=${limits.nofile}`)
  }
  return args
}

/**
 * Wrap a command with the configured sandbox layers.
 *
 * Composition (outermost first): `prlimit … -- bwrap … <cmd> <args>`. prlimit
 * is outermost so the rlimits inherit into the whole process tree; bwrap sets
 * up namespaces + the read-only fs around the real command. Layers that are
 * requested but unavailable are skipped with a warning (spawning never breaks).
 *
 * `findActualExecutable`, cooldown keys and UUID extraction must be computed on
 * the *original* command — only wrap at the final transport construction.
 */
export function wrapCommand(
  command: string,
  args: string[],
  cfg: ResolvedSandboxConfig,
  tools: SandboxTools = detectSandboxTools(),
): { command: string; args: string[] } {
  let resultCmd = command
  let resultArgs = [...args]

  // bwrap wraps the real command (inner layer).
  if (cfg.mode === "bwrap") {
    if (tools.bwrap) {
      resultArgs = [...buildBwrapArgs(cfg), resultCmd, ...resultArgs]
      resultCmd = tools.bwrap
    } else {
      logger.warn(
        "MCP_SANDBOX=bwrap requested but bubblewrap/userns unavailable — running without namespace isolation",
      )
    }
  }

  // prlimit wraps everything (outer layer) so rlimits cover the whole tree.
  if (hasResourceLimits(cfg)) {
    if (tools.prlimit) {
      resultArgs = [
        ...buildPrlimitArgs(cfg.limits),
        "--",
        resultCmd,
        ...resultArgs,
      ]
      resultCmd = tools.prlimit
    } else {
      logger.warn(
        "MCP resource limits requested but prlimit unavailable — spawning without limits",
      )
    }
  }

  return { command: resultCmd, args: resultArgs }
}
