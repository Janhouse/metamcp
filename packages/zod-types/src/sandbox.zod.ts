import { z } from "zod"

/**
 * Per-MCP-server sandbox / isolation configuration.
 *
 * These are the *user-facing overrides* persisted per server (jsonb column on
 * `mcp_servers`). Every field is optional: an unset field falls back to the
 * global default derived from environment variables (see the backend
 * `resolveSandboxConfig`). A `null`/absent value for the whole object means
 * "use the global defaults for everything".
 */
export const SandboxLimitsSchema = z.object({
  /** Address-space (virtual memory) cap in MB — maps to `prlimit --as`. */
  memoryMb: z.number().int().positive().optional(),
  /** CPU time cap in seconds — maps to `prlimit --cpu`. */
  cpuSec: z.number().int().positive().optional(),
  /** Max processes for the spawned tree — maps to `prlimit --nproc`. */
  nproc: z.number().int().positive().optional(),
  /** Max open file descriptors — maps to `prlimit --nofile`. */
  nofile: z.number().int().positive().optional(),
})

export type SandboxLimits = z.infer<typeof SandboxLimitsSchema>

export const SandboxConfigSchema = z.object({
  /**
   * Whether bubblewrap (namespace + read-only-fs) isolation is enabled for
   * this server. `undefined` inherits the global `MCP_SANDBOX` setting,
   * `true` forces bwrap mode, `false` forces it off (limits may still apply).
   */
  enabled: z.boolean().optional(),
  /** Allow network egress from the sandbox. `false` adds `--unshare-net`. */
  network: z.boolean().optional(),
  /** Mount the root filesystem read-only inside the sandbox. */
  readOnlyRoot: z.boolean().optional(),
  /** Extra host paths bind-mounted read-write into the sandbox. */
  allowPaths: z.array(z.string()).optional(),
  /** Per-process resource limits applied via `prlimit`. */
  limits: SandboxLimitsSchema.optional(),
})

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>
