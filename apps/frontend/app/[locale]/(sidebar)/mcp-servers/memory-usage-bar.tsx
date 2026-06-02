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
  "#8b5cf6", // violet-500
  "#14b8a6", // teal-500
  "#ef4444", // red-500
  "#84cc16", // lime-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
]
const METAMCP_COLOR = "#6366f1" // indigo-500
const OTHER_COLOR = "#9ca3af" // gray-400

interface Segment {
  key: string
  label: string
  bytes: number
  /** Inline color; when omitted the segment uses the muted track (free space). */
  color?: string
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

  const { total, used, metamcpBytes, servers } = data
  const serversTotal = servers.reduce((sum, s) => sum + s.memoryBytes, 0)
  // "Other" = everything used that isn't metamcp itself or an MCP server
  // (frontend, database, OS page cache, other container processes).
  const other = Math.max(0, used - metamcpBytes - serversTotal)
  const free = Math.max(0, total - used)

  const segments: Segment[] = [
    {
      key: "metamcp",
      label: t("mcp-servers:memoryBar.metamcp"),
      bytes: metamcpBytes,
      color: METAMCP_COLOR,
    },
    ...servers.map((s, i) => ({
      key: `server-${s.uuid}`,
      label: s.name,
      bytes: s.memoryBytes,
      color: SERVER_COLORS[i % SERVER_COLORS.length],
    })),
    {
      key: "other",
      label: t("mcp-servers:memoryBar.other"),
      bytes: other,
      color: OTHER_COLOR,
    },
    {
      key: "free",
      label: t("mcp-servers:memoryBar.free"),
      bytes: free,
      // no color -> muted track
    },
  ]

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
                  className={cn(
                    "h-full transition-[width]",
                    !seg.color && "bg-muted",
                  )}
                  style={{
                    width: `${pct(seg.bytes)}%`,
                    minWidth: "2px",
                    backgroundColor: seg.color,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <div className="font-medium">{seg.label}</div>
                <div>
                  {formatBytes(seg.bytes)} · {formatPct(seg.bytes)}
                </div>
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
              style={seg.color ? { backgroundColor: seg.color } : undefined}
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
