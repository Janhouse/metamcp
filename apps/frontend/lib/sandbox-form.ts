/**
 * Per-MCP-server sandbox / isolation configuration.
 *
 * NOTE: this mirrors `SandboxConfig` from `@repo/zod-types` (defined in that
 * package's `sandbox.zod.ts`). It is duplicated here because the package's
 * barrel (`index.ts`) does not re-export `sandbox.zod`, so the type is not
 * importable from the package root, and the frontend may not modify files
 * outside `apps/frontend`. Keep this in sync with the shared schema.
 */
export interface SandboxConfig {
  enabled?: boolean
  network?: boolean
  readOnlyRoot?: boolean
  allowPaths?: string[]
  limits?: {
    memoryMb?: number
    cpuSec?: number
    nproc?: number
    nofile?: number
  }
}

/**
 * Shape of the `sandbox` sub-object inside the create/edit MCP server forms.
 *
 * Every numeric limit and the allow-paths field is a string because HTML
 * inputs/textareas yield strings. Booleans are tri-state (undefined means the
 * user never touched the control, so the global default should be inherited).
 */
export interface SandboxFormValues {
  enabled?: boolean
  network?: boolean
  readOnlyRoot?: boolean
  allowPaths?: string
  memoryMb?: string
  cpuSec?: string
  nproc?: string
  nofile?: string
}

/**
 * Parse a user-entered number string into a positive integer, or undefined.
 *
 * - trimmed empty -> undefined
 * - finite and > 0 -> the parsed integer
 * - anything else -> undefined
 */
function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed === "") {
    return undefined
  }
  const parsed = Number.parseInt(trimmed, 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return undefined
}

/**
 * Convert the form `sandbox` sub-object into a `SandboxConfig`.
 *
 * Only keys the user actually provided are included. Numeric limits live under a
 * nested `limits` object that is only present when at least one limit is set.
 * Returns `undefined` when the resulting config is empty so callers can decide
 * whether to send `undefined` (create) or `null` (update).
 */
export function sandboxFormToConfig(
  formSandbox: SandboxFormValues | undefined,
): SandboxConfig | undefined {
  if (!formSandbox) {
    return undefined
  }

  const config: SandboxConfig = {}

  if (typeof formSandbox.enabled === "boolean") {
    config.enabled = formSandbox.enabled
  }
  if (typeof formSandbox.network === "boolean") {
    config.network = formSandbox.network
  }
  if (typeof formSandbox.readOnlyRoot === "boolean") {
    config.readOnlyRoot = formSandbox.readOnlyRoot
  }

  const allowPaths = (formSandbox.allowPaths ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  if (allowPaths.length > 0) {
    config.allowPaths = allowPaths
  }

  const limits: NonNullable<SandboxConfig["limits"]> = {}
  const memoryMb = parsePositiveInt(formSandbox.memoryMb)
  const cpuSec = parsePositiveInt(formSandbox.cpuSec)
  const nproc = parsePositiveInt(formSandbox.nproc)
  const nofile = parsePositiveInt(formSandbox.nofile)
  if (memoryMb !== undefined) {
    limits.memoryMb = memoryMb
  }
  if (cpuSec !== undefined) {
    limits.cpuSec = cpuSec
  }
  if (nproc !== undefined) {
    limits.nproc = nproc
  }
  if (nofile !== undefined) {
    limits.nofile = nofile
  }
  if (Object.keys(limits).length > 0) {
    config.limits = limits
  }

  if (Object.keys(config).length === 0) {
    return undefined
  }

  return config
}

/**
 * Convert a stored `SandboxConfig` back into the form sub-object shape, ready to
 * pass to react-hook-form `defaultValues` / `reset`.
 *
 * `allowPaths` is joined with newlines and numeric limits are stringified
 * (empty string when absent).
 */
export function sandboxConfigToForm(
  cfg: SandboxConfig | null | undefined,
): SandboxFormValues {
  return {
    enabled: cfg?.enabled,
    network: cfg?.network,
    readOnlyRoot: cfg?.readOnlyRoot,
    allowPaths: cfg?.allowPaths ? cfg.allowPaths.join("\n") : "",
    memoryMb:
      cfg?.limits?.memoryMb !== undefined ? String(cfg.limits.memoryMb) : "",
    cpuSec: cfg?.limits?.cpuSec !== undefined ? String(cfg.limits.cpuSec) : "",
    nproc: cfg?.limits?.nproc !== undefined ? String(cfg.limits.nproc) : "",
    nofile: cfg?.limits?.nofile !== undefined ? String(cfg.limits.nofile) : "",
  }
}
