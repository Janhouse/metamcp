import { readdirSync, readFileSync } from "node:fs"
import process from "node:process"

import logger from "@/utils/logger"

/**
 * Per-process resident memory measurement via Linux `/proc`.
 *
 * Spawned STDIO MCP servers are sandboxed as `prlimit -- bwrap --unshare-pid …
 * <realcmd>`, so the pid we hold (the transport pid) is the wrapper and the real
 * server is a descendant in a child PID namespace. The host `/proc` still lists
 * those descendants (with host-namespace pids/ppids), so we attribute a server's
 * memory by summing RSS over the whole process tree rooted at its pid.
 *
 * Linux-only. On other platforms (or if `/proc` can't be read) the readers
 * return null so callers can render "unavailable" rather than a wrong number.
 */

// Standard Linux page size. `/proc/<pid>/stat` reports rss in pages; Node has no
// sysconf(_SC_PAGESIZE), and 4096 is the near-universal value on the Linux/Docker
// targets metamcp runs on.
const PAGE_SIZE = 4096

export interface ProcStat {
  ppid: number
  rssBytes: number
}

/**
 * Parse a single `/proc/<pid>/stat` line into pid/ppid/rss.
 *
 * The `comm` field (field 2) is wrapped in parentheses and may itself contain
 * spaces and parentheses, so we split on the LAST ")" before tokenizing the
 * numeric fields. After that boundary, field 4 (ppid) is index 1 and field 24
 * (rss, in pages) is index 21.
 */
export function parseStatLine(
  content: string,
): { pid: number; stat: ProcStat } | null {
  const firstParen = content.indexOf("(")
  const lastParen = content.lastIndexOf(")")
  if (firstParen === -1 || lastParen === -1 || lastParen < firstParen) {
    return null
  }

  const pid = Number.parseInt(content.slice(0, firstParen).trim(), 10)
  if (!Number.isInteger(pid)) {
    return null
  }

  const rest = content
    .slice(lastParen + 1)
    .trim()
    .split(/\s+/)
  // rest[0] = state (field 3), rest[1] = ppid (field 4), rest[21] = rss (field 24)
  const ppid = Number.parseInt(rest[1] ?? "", 10)
  const rssPages = Number.parseInt(rest[21] ?? "", 10)
  if (!Number.isInteger(ppid) || !Number.isInteger(rssPages)) {
    return null
  }

  return { pid, stat: { ppid, rssBytes: rssPages * PAGE_SIZE } }
}

/**
 * Snapshot every process from `/proc`: pid -> { ppid, rssBytes }. Returns null
 * when `/proc` is unavailable (non-Linux), or an empty map on a transient read
 * failure of the directory.
 */
export function readProcStats(): Map<number, ProcStat> | null {
  if (process.platform !== "linux") {
    return null
  }

  let entries: string[]
  try {
    entries = readdirSync("/proc")
  } catch (error) {
    logger.warn("Unable to read /proc for memory stats:", error)
    return null
  }

  const stats = new Map<number, ProcStat>()
  for (const entry of entries) {
    // Only numeric entries are process directories.
    if (!/^\d+$/.test(entry)) continue
    try {
      const content = readFileSync(`/proc/${entry}/stat`, "utf8")
      const parsed = parseStatLine(content)
      if (parsed) {
        stats.set(parsed.pid, parsed.stat)
      }
    } catch {
      // Process exited between readdir and read — ignore.
    }
  }
  return stats
}

/**
 * Sum RSS over the process trees rooted at each of `rootPids` (inclusive),
 * walking children by ppid. A shared visited set across all roots prevents
 * double counting when one root is a descendant of another.
 */
export function sumProcessTreeRss(
  rootPids: number[],
  stats: Map<number, ProcStat>,
): number {
  // Build ppid -> children index once.
  const children = new Map<number, number[]>()
  for (const [pid, stat] of stats) {
    const siblings = children.get(stat.ppid)
    if (siblings) {
      siblings.push(pid)
    } else {
      children.set(stat.ppid, [pid])
    }
  }

  const visited = new Set<number>()
  let total = 0
  const stack = [...rootPids]
  while (stack.length > 0) {
    const pid = stack.pop() as number
    if (visited.has(pid)) continue
    visited.add(pid)
    const stat = stats.get(pid)
    if (stat) {
      total += stat.rssBytes
    }
    const kids = children.get(pid)
    if (kids) {
      for (const kid of kids) {
        if (!visited.has(kid)) stack.push(kid)
      }
    }
  }
  return total
}

/**
 * Resident memory (bytes) of the process tree(s) rooted at the given pids.
 * Returns null when `/proc` is unavailable.
 */
export function getRssForPids(pids: number[]): number | null {
  const stats = readProcStats()
  if (!stats) return null
  if (pids.length === 0) return 0
  return sumProcessTreeRss(pids, stats)
}

// ---------------------------------------------------------------------------
// Shared vs private breakdown (via /proc/<pid>/smaps_rollup)
// ---------------------------------------------------------------------------

/** Per-process memory split. `private` = pages mapped only by this process. */
export interface ProcMemory {
  rssBytes: number
  pssBytes: number
  privateBytes: number
}

/**
 * Parse `/proc/<pid>/smaps_rollup`. `Pss` (proportional set size) splits shared
 * pages across their sharers; `Private_Clean + Private_Dirty` is the memory
 * unique to this process. Returns null if the required fields are absent (older
 * kernels without smaps_rollup).
 */
export function parseSmapsRollup(content: string): ProcMemory | null {
  const field = (name: string): number | null => {
    const m = content.match(new RegExp(`^${name}:\\s+(\\d+)\\s*kB`, "m"))
    return m ? Number.parseInt(m[1], 10) : null
  }
  const rss = field("Rss")
  const pss = field("Pss")
  if (rss === null || pss === null) return null
  const priv = (field("Private_Clean") ?? 0) + (field("Private_Dirty") ?? 0)
  return {
    rssBytes: rss * 1024,
    pssBytes: pss * 1024,
    privateBytes: priv * 1024,
  }
}

/** Read the smaps rollup for one pid, or null if unavailable/unreadable. */
export function readSmapsRollup(pid: number): ProcMemory | null {
  try {
    return parseSmapsRollup(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"))
  } catch {
    return null
  }
}

/**
 * Expand root pids to the full set of pids in their process trees (inclusive),
 * walking children by ppid. Only pids present in `stats` are returned.
 */
export function expandTree(
  rootPids: number[],
  stats: Map<number, ProcStat>,
): number[] {
  const children = new Map<number, number[]>()
  for (const [pid, stat] of stats) {
    const siblings = children.get(stat.ppid)
    if (siblings) siblings.push(pid)
    else children.set(stat.ppid, [pid])
  }

  const visited = new Set<number>()
  const out: number[] = []
  const stack = [...rootPids]
  while (stack.length > 0) {
    const pid = stack.pop() as number
    if (visited.has(pid)) continue
    visited.add(pid)
    if (stats.has(pid)) out.push(pid)
    const kids = children.get(pid)
    if (kids) {
      for (const kid of kids) if (!visited.has(kid)) stack.push(kid)
    }
  }
  return out
}

/** Find pids whose (null-separated) cmdline contains `needle`. */
export function findPidsByCmdline(
  needle: string,
  stats: Map<number, ProcStat>,
): number[] {
  const out: number[] = []
  for (const pid of stats.keys()) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8")
      if (cmd.includes(needle)) out.push(pid)
    } catch {
      // exited between snapshot and read — ignore
    }
  }
  return out
}

/**
 * Sum rss/pss/private over the given pids. Uses smaps_rollup per process; when a
 * process's rollup can't be read it falls back to treating its full RSS as
 * private (so it still contributes, just without a shared split).
 */
export function measurePids(
  pids: number[],
  stats: Map<number, ProcStat>,
): ProcMemory {
  let rssBytes = 0
  let pssBytes = 0
  let privateBytes = 0
  for (const pid of pids) {
    const rollup = readSmapsRollup(pid)
    if (rollup) {
      rssBytes += rollup.rssBytes
      pssBytes += rollup.pssBytes
      privateBytes += rollup.privateBytes
    } else {
      const rss = stats.get(pid)?.rssBytes ?? 0
      rssBytes += rss
      pssBytes += rss
      privateBytes += rss
    }
  }
  return { rssBytes, pssBytes, privateBytes }
}
