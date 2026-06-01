"use client"

import { type McpServer, McpServerTypeEnum } from "@repo/zod-types"
import { useMemoizedFn } from "ahooks"
import { ChevronDown, Edit, Eye, SearchCode, Server } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import React, { Suspense, useMemo, useState } from "react"

import { EditMcpServer } from "@/components/edit-mcp-server"
import { InspectorSkeleton } from "@/components/skeletons/inspector-skeleton"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { useConnection } from "@/hooks/useConnection"
import { useTranslations } from "@/hooks/useTranslations"
import { resolveEndpointNamespaceUuid } from "@/lib/endpoint-server"
import type { Notification } from "@/lib/notificationTypes"
import { trpc } from "@/lib/trpc"

import { Inspector } from "./components/inspector"
import { NotificationsPanel } from "./components/notifications-panel"

interface NotificationEntry {
  id: string
  notification: Notification
  timestamp: Date
  type: "notification" | "stderr"
}

function McpInspectorContent() {
  const { t } = useTranslations()
  const [editDialogOpen, setEditDialogOpen] = useState<boolean>(false)
  const [notifications, setNotifications] = useState<NotificationEntry[]>([])
  const searchParams = useSearchParams()
  const router = useRouter()

  // Get selectedServerUuid directly from search params
  const selectedServerUuid = searchParams.get("server") || ""

  // Fetch MCP servers list
  const { data: serversResponse, isLoading: serversLoading } =
    trpc.frontend.mcpServers.list.useQuery()

  // Memoize servers array to prevent unnecessary re-renders
  const servers: McpServer[] = useMemo(() => {
    return serversResponse?.success ? serversResponse.data : []
  }, [serversResponse])

  // Get selected server details
  const selectedServer = servers.find(
    (server) => server.uuid === selectedServerUuid,
  )

  // Auto-generated endpoint servers (STREAMABLE_HTTP -> /metamcp/<name>/mcp)
  // point at the endpoint's auth-gated public URL, which a stored bearer token
  // often can't satisfy (OAuth-only endpoints / rotated API keys). When the
  // selected server backs an endpoint, inspect the underlying namespace through
  // the authenticated metamcp proxy instead (same tools, logged-in session +
  // namespace access check).
  const { data: endpointsResponse, isLoading: endpointsLoading } =
    trpc.frontend.endpoints.list.useQuery()
  const endpointNamespaceUuid = resolveEndpointNamespaceUuid(
    selectedServer,
    endpointsResponse?.success ? endpointsResponse.data : undefined,
  )
  const isEndpointServer = endpointNamespaceUuid !== null

  // Notification management functions using useMemoizedFn
  const addNotification = useMemoizedFn(
    (notification: Notification, type: "notification" | "stderr") => {
      const entry: NotificationEntry = {
        id: `${Date.now()}-${Math.random()}`,
        notification,
        timestamp: new Date(),
        type,
      }
      setNotifications((prev) => [entry, ...prev])
    },
  )

  const clearNotifications = useMemoizedFn(() => {
    setNotifications([])
  })

  const removeNotification = useMemoizedFn((id: string) => {
    setNotifications((prev) =>
      prev.filter((notification) => notification.id !== id),
    )
  })

  // Memoized notification callbacks for useConnection
  const onNotification = useMemoizedFn((notification: Notification) => {
    addNotification(notification, "notification")
  })

  const onStdErrNotification = useMemoizedFn((notification: Notification) => {
    addNotification(notification, "stderr")
  })

  // MCP Connection setup - only enable when server data is loaded and valid
  const connection = useConnection({
    mcpServerUuid: selectedServerUuid,
    transportType: isEndpointServer
      ? McpServerTypeEnum.enum.SSE
      : selectedServer?.type || McpServerTypeEnum.enum.STDIO,
    command: selectedServer?.command || "",
    args: selectedServer?.args?.join(" ") || "",
    // For endpoint servers, connect to the namespace via the authenticated
    // metamcp proxy rather than the OAuth/API-key-gated public endpoint URL.
    url: isEndpointServer
      ? `/mcp-proxy/metamcp/${endpointNamespaceUuid}/sse`
      : selectedServer?.url || "",
    env: selectedServer?.env || {},
    bearerToken: isEndpointServer
      ? undefined
      : selectedServer?.bearerToken || undefined,
    isMetaMCP: isEndpointServer,
    onNotification,
    onStdErrNotification,
    // Wait for the endpoints list too: until it loads we cannot tell whether
    // this is an endpoint server, and connecting via the wrong URL first would
    // fail without retrying (connect is a stable callback).
    enabled: Boolean(
      selectedServer &&
        !serversLoading &&
        !endpointsLoading &&
        selectedServerUuid,
    ),
  })

  // Keep the latest connection status in a ref so the auto-connect effect can
  // read it without depending on it. Depending on connectionStatus — or on the
  // whole `connection` object, which is a fresh literal every render — would
  // re-run the effect on every render and, combined with the clearNotifications
  // setState below, cause an infinite render loop (React error #185).
  const connectionStatusRef = React.useRef(connection.connectionStatus)
  connectionStatusRef.current = connection.connectionStatus

  // Whether the selected server's details have loaded. A boolean (rather than
  // the `selectedServer` object, whose reference churns when the list refetches)
  // keeps the effect deps stable.
  const hasSelectedServer = Boolean(selectedServer)

  // `connect`/`disconnect`/`clearNotifications` are stable (useMemoizedFn), so
  // listing them does not re-trigger the effect; the meaningful triggers are the
  // URL server id, the loading flag and whether the server has loaded. Run only
  // when the selected server actually changes: clear notifications and
  // auto-connect (tearing down a prior connection first).
  const { connect, disconnect } = connection
  React.useEffect(() => {
    clearNotifications()

    // Wait for both the servers list and the endpoints list: the latter decides
    // whether to connect via the namespace proxy vs the server's own URL.
    if (
      !selectedServerUuid ||
      serversLoading ||
      endpointsLoading ||
      !hasSelectedServer
    ) {
      return
    }
    if (connectionStatusRef.current === "connected") {
      // Connected to a previous server — tear it down before reconnecting.
      disconnect().then(() => {
        connect()
      })
    } else if (connectionStatusRef.current === "disconnected") {
      connect()
    }
  }, [
    selectedServerUuid,
    serversLoading,
    endpointsLoading,
    hasSelectedServer,
    clearNotifications,
    connect,
    disconnect,
  ])

  const handleConnectionToggle = useMemoizedFn(() => {
    if (connection.connectionStatus === "connected") {
      connection.disconnect().then(() => {
        connection.connect()
      })
    } else {
      connection.connect()
    }
  })

  // Handle successful edit
  const handleEditSuccess = useMemoizedFn(() => {
    setEditDialogOpen(false)
  })

  // Get connection status display info
  const getConnectionStatusInfo = useMemoizedFn(() => {
    switch (connection.connectionStatus) {
      case "connected":
        return {
          text: t("inspector:connected"),
          color: "text-green-600 dark:text-green-400",
        }
      case "disconnected":
        return {
          text: t("inspector:disconnected"),
          color: "text-gray-500 dark:text-gray-400",
        }
      case "error":
      case "error-connecting-to-proxy":
        return {
          text: t("inspector:connectionError"),
          color: "text-red-600 dark:text-red-400",
        }
      default:
        return {
          text: t("inspector:connecting"),
          color: "text-yellow-600 dark:text-yellow-400",
        }
    }
  })

  const connectionInfo = getConnectionStatusInfo()

  // Function to handle server selection and update URL
  const handleServerSelect = useMemoizedFn((serverUuid: string) => {
    // Update URL parameter
    const params = new URLSearchParams(searchParams.toString())
    if (serverUuid) {
      params.set("server", serverUuid)
    } else {
      params.delete("server")
    }
    router.replace(`/mcp-inspector?${params.toString()}`)
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <SearchCode className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("inspector:title")}
            </h1>
            <p className="text-muted-foreground">{t("inspector:subtitle")}</p>
          </div>
        </div>

        <Separator />

        {/* MCP Server Selection */}
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">
            {t("inspector:serverSelection")}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="justify-between min-w-[300px]"
              >
                <span>
                  {selectedServer
                    ? selectedServer.name
                    : t("inspector:selectServerDropdown")}
                </span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[300px]">
              {serversLoading ? (
                <DropdownMenuItem disabled>
                  {t("inspector:loadingServers")}
                </DropdownMenuItem>
              ) : servers.length === 0 ? (
                <DropdownMenuItem disabled>
                  {t("inspector:noServersAvailable")}
                </DropdownMenuItem>
              ) : (
                servers.map((server) => (
                  <DropdownMenuItem
                    key={server.uuid}
                    onClick={() => handleServerSelect(server.uuid)}
                    className="flex flex-col items-start gap-1"
                  >
                    <div className="font-medium">{server.name}</div>
                    {server.description && (
                      <div className="text-xs text-muted-foreground">
                        {server.description}
                      </div>
                    )}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Connection Status and Controls */}
          {selectedServer && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t("inspector:connectionStatus")}
              </span>
              <span className={`text-sm font-medium ${connectionInfo.color}`}>
                {connectionInfo.text}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleConnectionToggle}
                disabled={
                  connection.connectionStatus === "connecting" || serversLoading
                }
              >
                {connection.connectionStatus === "connected"
                  ? t("inspector:reconnectButton")
                  : t("inspector:connectButton")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  router.push(`/mcp-servers/${selectedServerUuid}`)
                }
              >
                <Eye className="h-4 w-4 mr-2" />
                {t("mcp-servers:list.viewDetails")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditDialogOpen(true)}
              >
                <Edit className="h-4 w-4 mr-2" />
                {t("inspector:editServerButton")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Edit Server Dialog */}
      {selectedServer && (
        <EditMcpServer
          server={selectedServer}
          isOpen={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Inspector Content */}
      <div className="rounded-lg border p-6">
        {selectedServer ? (
          connection.connectionStatus === "connected" ? (
            <Inspector
              mcpServerUuid={selectedServerUuid}
              makeRequest={connection.makeRequest}
              serverCapabilities={connection.serverCapabilities}
            />
          ) : (
            <div className="space-y-4">
              <InspectorSkeleton />
              <div className="flex justify-center">
                <div className="text-sm text-muted-foreground">
                  {connection.connectionStatus === "connecting"
                    ? t("inspector:connectingToServer")
                    : t("inspector:connectToStart")}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Server className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {t("inspector:noServerSelected")}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t("inspector:noServerSelectedDesc")}
            </p>
          </div>
        )}
      </div>

      {/* Notifications Panel */}
      <NotificationsPanel
        notifications={notifications}
        onClearNotifications={clearNotifications}
        onRemoveNotification={removeNotification}
      />
    </div>
  )
}

export default function McpInspectorPage() {
  return (
    <Suspense fallback={<InspectorSkeleton />}>
      <McpInspectorContent />
    </Suspense>
  )
}
