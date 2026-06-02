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

function readCgroupV2(): { total: number; used: number } | null {
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
      }
    }
    return null
  }
  return null
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
      }
    }
    const v1 = readCgroupV1()
    if (v1) {
      return {
        total: v1.total,
        used: v1.used,
        free: Math.max(0, v1.total - v1.used),
        source: "cgroup_v1",
      }
    }
  }

  const total = os.totalmem()
  const free = os.freemem()
  return { total, used: Math.max(0, total - free), free, source: "host" }
}
