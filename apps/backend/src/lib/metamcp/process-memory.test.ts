import { describe, expect, it } from "vitest"

import {
  type ProcStat,
  parseStatLine,
  sumProcessTreeRss,
} from "./process-memory"

// rss is field 24 (in pages); PAGE_SIZE is 4096 in the module.
const PAGE_SIZE = 4096

// Build a synthetic `/proc/<pid>/stat` line. The leading fields are
// pid (comm) state ppid ...; rss is the 24th field. We pad fields 5..23 with
// zeros so rss lands in the right position.
function statLine(pid: number, comm: string, ppid: number, rssPages: number) {
  const fields: (string | number)[] = [pid, `(${comm})`, "S", ppid]
  // fields 5..23 (pgrp..vsize) — 19 placeholder values.
  for (let i = 5; i <= 23; i++) fields.push(0)
  fields.push(rssPages) // field 24: rss
  return fields.join(" ")
}

describe("parseStatLine", () => {
  it("parses pid, ppid and rss", () => {
    const parsed = parseStatLine(statLine(42, "node", 1, 10))
    expect(parsed).toEqual({
      pid: 42,
      stat: { ppid: 1, rssBytes: 10 * PAGE_SIZE },
    })
  })

  it("handles a comm containing spaces and parentheses", () => {
    const parsed = parseStatLine(statLine(7, "weird (name) :)", 3, 25))
    expect(parsed).not.toBeNull()
    expect(parsed?.pid).toBe(7)
    expect(parsed?.stat.ppid).toBe(3)
    expect(parsed?.stat.rssBytes).toBe(25 * PAGE_SIZE)
  })

  it("returns null on malformed input", () => {
    expect(parseStatLine("not a stat line")).toBeNull()
  })
})

describe("sumProcessTreeRss", () => {
  // Tree:  100 (wrapper) -> 200 (server) -> 300 (worker)
  //        400 (unrelated)
  const stats = new Map<number, ProcStat>([
    [100, { ppid: 1, rssBytes: 1 * PAGE_SIZE }],
    [200, { ppid: 100, rssBytes: 2 * PAGE_SIZE }],
    [300, { ppid: 200, rssBytes: 4 * PAGE_SIZE }],
    [400, { ppid: 1, rssBytes: 8 * PAGE_SIZE }],
  ])

  it("sums the whole tree rooted at a pid (inclusive of descendants)", () => {
    // 100 + 200 + 300 = 7 pages
    expect(sumProcessTreeRss([100], stats)).toBe(7 * PAGE_SIZE)
  })

  it("does not double count when roots overlap", () => {
    // 100's tree already includes 200/300; adding 200 must not re-add them.
    expect(sumProcessTreeRss([100, 200], stats)).toBe(7 * PAGE_SIZE)
  })

  it("sums multiple independent roots", () => {
    expect(sumProcessTreeRss([200, 400], stats)).toBe((2 + 4 + 8) * PAGE_SIZE)
  })

  it("returns 0 for an unknown pid", () => {
    expect(sumProcessTreeRss([999], stats)).toBe(0)
  })
})
