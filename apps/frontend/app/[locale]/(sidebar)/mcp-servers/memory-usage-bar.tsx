"use client"

import type { McpServersMemoryUsage } from "@repo/zod-types"
import { MemoryStick } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTranslations } from "@/hooks/useTranslations"
import { cn, formatBytes } from "@/lib/utils"

// Distinct colors per MCP server, cycled by index. Saturated tones read well in
// both light and dark themes.
const SERVER_COLORS = [
  "#0ea5e9", // sky-500
  "#22c55e", // green-500
  "#f59e0b", // amber-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
  "#ef4444", // red-500
  "#84cc16", // lime-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#d946ef", // fuchsia-500
]
const BACKEND_COLOR = "#6366f1" // indigo-500
const FRONTEND_COLOR = "#a855f7" // purple-500
const OTHER_COLOR = "#9ca3af" // gray-400 — hard (kernel/shmem)
const CACHE_COLOR = "#cbd5e1" // slate-300 — soft (reclaimable cache)

// Diagonal stripes for the de-duplicated shared block.
const SHARED_STRIPES =
  "repeating-linear-gradient(45deg, rgba(255,255,255,0.45) 0, rgba(255,255,255,0.45) 3px, transparent 3px, transparent 6px)"

interface Segment {
  key: string
  label: string
  /** Width of the segment, in bytes (relative to total). */
  bytes: number
  color?: string
  striped?: boolean
  /** Optional qualifier shown before the value (e.g. "Unique"). */
  valueLabel?: string
  /** Optional rss/pss detail line for the tooltip. */
  detail?: string
}

interface MemoryUsageBarProps {
  data: McpServersMemoryUsage | undefined
  className?: string
}

export function MemoryUsageBar({ data, className }: MemoryUsageBarProps) {
  const { t } = useTranslations()

  if (!data || data.total <= 0) {
    return null
  }

  const { total, used, backend, frontend, servers, sharedBytes, metric } = data
  const hasSplit = metric === "smaps"
  // The solid slices draw each entity's PRIVATE memory, so label the headline
  // "Unique" (only meaningful when we have the smaps split).
  const uniqueLabel = hasSplit ? t("mcp-servers:memoryBar.unique") : undefined

  // Detail line showing how RSS over-counts vs the deduplicated PSS.
  const procDetail = (m: { rssBytes: number; pssBytes: number }) =>
    hasSplit
      ? t("mcp-servers:memoryBar.rssPss", {
          rss: formatBytes(m.rssBytes),
          pss: formatBytes(m.pssBytes),
        })
      : undefined

  const sumPrivate =
    backend.privateBytes +
    (frontend?.privateBytes ?? 0) +
    servers.reduce((s, srv) => s + srv.privateBytes, 0)

  // Solid slices use each entity's PRIVATE (unique) memory; the shared pages are
  // their own striped block so they're only drawn once.
  const other = Math.max(0, used - sumPrivate - sharedBytes)
  const free = Math.max(0, total - used)

  const segments: Segment[] = [
    {
      key: "backend",
      label: t("mcp-servers:memoryBar.backend"),
      bytes: backend.privateBytes,
      color: BACKEND_COLOR,
      valueLabel: uniqueLabel,
      detail: procDetail(backend),
    },
  ]
  if (frontend) {
    segments.push({
      key: "frontend",
      label: t("mcp-servers:memoryBar.frontend"),
      bytes: frontend.privateBytes,
      color: FRONTEND_COLOR,
      valueLabel: uniqueLabel,
      detail: procDetail(frontend),
    })
  }
  servers.forEach((srv, i) => {
    segments.push({
      key: `server-${srv.uuid}`,
      label: srv.name,
      bytes: srv.privateBytes,
      color: SERVER_COLORS[i % SERVER_COLORS.length],
      valueLabel: uniqueLabel,
      detail: hasSplit
        ? t("mcp-servers:memoryBar.rssPssProcs", {
            rss: formatBytes(srv.rssBytes),
            pss: formatBytes(srv.pssBytes),
            count: srv.processCount,
          })
        : t("mcp-servers:memoryBar.procs", { count: srv.processCount }),
    })
  })
  if (hasSplit && sharedBytes > 0) {
    segments.push({
      key: "shared",
      label: t("mcp-servers:memoryBar.shared"),
      bytes: sharedBytes,
      color: OTHER_COLOR,
      striped: true,
      detail: t("mcp-servers:memoryBar.sharedHint"),
    })
  }
  // Split "other" into reclaimable cache (evicted before OOM) vs hard
  // kernel/shmem/anon, when the cgroup exposes the reclaimable figure.
  if (data.reclaimableBytes != null) {
    const cache = Math.min(other, data.reclaimableBytes)
    segments.push({
      key: "cache",
      label: t("mcp-servers:memoryBar.cache"),
      bytes: cache,
      color: CACHE_COLOR,
      detail: t("mcp-servers:memoryBar.cacheHint"),
    })
    segments.push({
      key: "kernelShmem",
      label: t("mcp-servers:memoryBar.kernelShmem"),
      bytes: Math.max(0, other - cache),
      color: OTHER_COLOR,
      detail: t("mcp-servers:memoryBar.kernelShmemHint"),
    })
  } else {
    segments.push({
      key: "other",
      label: t("mcp-servers:memoryBar.other"),
      bytes: other,
      color: OTHER_COLOR,
      detail: t("mcp-servers:memoryBar.otherHint"),
    })
  }
  segments.push({
    key: "free",
    label: t("mcp-servers:memoryBar.free"),
    bytes: free,
  })

  const pct = (bytes: number) => (total > 0 ? (bytes / total) * 100 : 0)
  const formatPct = (bytes: number) => {
    const p = pct(bytes)
    if (p > 0 && p < 0.1) return "<0.1%"
    return `${p.toFixed(1)}%`
  }

  const sourceLabel =
    data.source === "host"
      ? t("mcp-servers:memoryBar.hostMemory")
      : t("mcp-servers:memoryBar.containerLimit")

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 font-medium">
          <MemoryStick className="h-4 w-4 text-muted-foreground" />
          {t("mcp-servers:memoryBar.title")}
        </div>
        <div className="text-muted-foreground">
          {t("mcp-servers:memoryBar.usedOfTotal", {
            used: formatBytes(used),
            total: formatBytes(total),
          })}{" "}
          · {sourceLabel}
        </div>
      </div>

      <div className="flex h-4 w-full overflow-hidden rounded-md bg-muted">
        {segments.map((seg) =>
          seg.bytes <= 0 ? null : (
            <Tooltip key={seg.key}>
              <TooltipTrigger asChild>
                <div
                  className={cn("h-full", !seg.color && "bg-muted")}
                  style={{
                    width: `${pct(seg.bytes)}%`,
                    minWidth: "2px",
                    backgroundColor: seg.color,
                    backgroundImage: seg.striped ? SHARED_STRIPES : undefined,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <div className="font-medium">{seg.label}</div>
                <div>
                  {seg.valueLabel ? `${seg.valueLabel} ` : ""}
                  {formatBytes(seg.bytes)} · {formatPct(seg.bytes)}
                </div>
                {seg.detail && (
                  <div className="text-primary-foreground/75">{seg.detail}</div>
                )}
              </TooltipContent>
            </Tooltip>
          ),
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-1.5">
            <span
              className={cn("inline-block h-2.5 w-2.5 rounded-sm", {
                "bg-muted-foreground/30": !seg.color,
              })}
              style={
                seg.color
                  ? {
                      backgroundColor: seg.color,
                      backgroundImage: seg.striped ? SHARED_STRIPES : undefined,
                    }
                  : undefined
              }
            />
            <span>
              {seg.label} — {formatBytes(seg.bytes)}
            </span>
          </div>
        ))}
      </div>

      {!data.available && (
        <p className="text-xs text-muted-foreground">
          {t("mcp-servers:memoryBar.perServerUnavailable")}
        </p>
      )}
    </div>
  )
}
