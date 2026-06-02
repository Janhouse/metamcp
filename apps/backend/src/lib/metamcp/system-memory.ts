import { readFileSync } from "node:fs"
import os from "node:os"
import process from "node:process"

/**
 * Total memory budget available to metamcp.
 *
 * When running inside a container with a memory limit, the meaningful "total" is
 * the cgroup limit (and "used" the cgroup's current usage). Without a limit — or
 * on a bare host — fall back to host RAM (`os.totalmem`/`os.freemem`). Node reads
 * host-wide values from `/proc/meminfo`, so an unlimited container correctly
 * reports the host total.
 */

export type MemorySource = "cgroup_v2" | "cgroup_v1" | "host"

export interface MemoryBudget {
  /** Total bytes available (cgroup limit, or host total RAM). */
  total: number
  /** Bytes currently in use (cgroup current, or host total - free). */
  used: number
  /** Bytes free (total - used). */
  free: number
  source: MemorySource
  /**
   * Reclaimable bytes — unmapped page cache plus reclaimable slab — that the
   * kernel evicts under pressure before OOM. Lets the UI split "used" into soft
   * (cache) vs hard (kernel/shmem/anon). Null when not derivable (host, cgroup
   * v1, or no `memory.stat`).
   */
  reclaimableBytes: number | null
}

/**
 * Read a cgroup value file. Returns the numeric byte value, `Infinity` for the
 * literal "max" (unlimited), or null when the file is missing/unreadable.
 */
function readCgroupValue(path: string): number | null {
  try {
    const raw = readFileSync(path, "utf8").trim()
    if (raw === "max") return Number.POSITIVE_INFINITY
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/**
 * Candidate cgroup v2 base dirs: the mount root (correct inside a container with
 * a cgroup namespace) plus this process's own leaf path from `/proc/self/cgroup`
 * (needed on a non-namespaced host where the root has no `memory.max`).
 */
function cgroupV2Dirs(): string[] {
  const dirs = ["/sys/fs/cgroup"]
  try {
    const self = readFileSync("/proc/self/cgroup", "utf8")
    const rel = self
      .split("\n")
      .find((line) => line.startsWith("0::"))
      ?.slice(3)
      .trim()
    if (rel && rel !== "/") {
      dirs.push(`/sys/fs/cgroup${rel}`)
    }
  } catch {
    // /proc/self/cgroup unreadable — root dir only.
  }
  return dirs
}

function readCgroupV2(): {
  total: number
  used: number
  dir: string
} | null {
  const hostTotal = os.totalmem()
  for (const dir of cgroupV2Dirs()) {
    const max = readCgroupValue(`${dir}/memory.max`)
    if (max === null) continue // not a cgroup v2 dir — try the next candidate
    // A real cap is a finite value below host total; "max"/huge values mean
    // unlimited, in which case the host budget is the right answer.
    if (Number.isFinite(max) && max > 0 && max < hostTotal) {
      const current = readCgroupValue(`${dir}/memory.current`)
      return {
        total: max,
        used: current !== null && Number.isFinite(current) ? current : 0,
        dir,
      }
    }
    return null
  }
  return null
}

/** Parse a cgroup `memory.stat` file ("key value\n" lines) into a map. */
function parseMemoryStat(content: string): Map<string, number> {
  const stat = new Map<string, number>()
  for (const line of content.split("\n")) {
    const sp = line.indexOf(" ")
    if (sp === -1) continue
    const value = Number.parseInt(line.slice(sp + 1), 10)
    if (Number.isFinite(value)) stat.set(line.slice(0, sp), value)
  }
  return stat
}

/**
 * Reclaimable bytes from a cgroup v2 `memory.stat`: page cache not mapped into
 * any process (`file − file_mapped`, so it doesn't overlap mapped pages already
 * counted in per-process PSS) plus reclaimable slab (dentry/inode caches).
 */
function readReclaimableV2(dir: string): number | null {
  try {
    const stat = parseMemoryStat(readFileSync(`${dir}/memory.stat`, "utf8"))
    const file = stat.get("file") ?? 0
    const fileMapped = stat.get("file_mapped") ?? 0
    const slabReclaimable = stat.get("slab_reclaimable") ?? 0
    return Math.max(0, file - fileMapped) + slabReclaimable
  } catch {
    return null
  }
}

function readCgroupV1(): { total: number; used: number } | null {
  const hostTotal = os.totalmem()
  const limit = readCgroupValue("/sys/fs/cgroup/memory/memory.limit_in_bytes")
  // v1 encodes "unlimited" as a huge sentinel (~9.2e18); treat anything >= host
  // total as no real limit.
  if (limit === null || !Number.isFinite(limit) || limit <= 0) return null
  if (limit >= hostTotal) return null
  const usage = readCgroupValue("/sys/fs/cgroup/memory/memory.usage_in_bytes")
  return {
    total: limit,
    used: usage !== null && Number.isFinite(usage) ? usage : 0,
  }
}

export function getMemoryBudget(): MemoryBudget {
  if (process.platform === "linux") {
    const v2 = readCgroupV2()
    if (v2) {
      return {
        total: v2.total,
        used: v2.used,
        free: Math.max(0, v2.total - v2.used),
        source: "cgroup_v2",
        reclaimableBytes: readReclaimableV2(v2.dir),
      }
    }
    const v1 = readCgroupV1()
    if (v1) {
      return {
        total: v1.total,
        used: v1.used,
        free: Math.max(0, v1.total - v1.used),
        source: "cgroup_v1",
        reclaimableBytes: null,
      }
    }
  }

  const total = os.totalmem()
  const free = os.freemem()
  return {
    total,
    used: Math.max(0, total - free),
    free,
    source: "host",
    reclaimableBytes: null,
  }
}
