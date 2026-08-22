import path from "node:path"

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Monorepo: trace the workspace root so the standalone server bundles the
  // hoisted node_modules and workspace packages (@repo/*). Without this, Next
  // guesses the tracing root from the nearest lockfile and can omit files.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // sharp >=0.35 hides libvips-cpp.so behind a stub.node that output tracing
  // can't follow (lovell/sharp#4543); force-include the glibc variant (the
  // oven/bun:1.4 runner is Debian). Path is relative to this app dir;
  // node_modules is hoisted at the workspace root.
  outputFileTracingIncludes: {
    "/*": [
      // hoisted layout
      "../../node_modules/@img/sharp-libvips-linux-x64/**/*",
      // bun isolated-install store layout
      "../../node_modules/.bun/@img+sharp-libvips-linux-x64@*/**/*",
    ],
  },
  experimental: {
    proxyTimeout: 1000 * 120,
  },
  async rewrites() {
    // Use localhost for rewrites since frontend and backend run in the same container
    const backendUrl = "http://localhost:12009"

    return [
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
      // OAuth endpoints - proxy all oauth paths
      {
        source: "/oauth/:path*",
        destination: `${backendUrl}/oauth/:path*`,
      },
      // Well-known endpoints - proxy all well-known paths
      {
        source: "/.well-known/:path*",
        destination: `${backendUrl}/.well-known/:path*`,
      },
      // Auth API endpoints
      {
        source: "/api/auth/:path*",
        destination: `${backendUrl}/api/auth/:path*`,
      },
      // Register endpoint for dynamic client registration
      {
        source: "/register",
        destination: `${backendUrl}/api/auth/register`,
      },
      {
        source: "/trpc/:path*",
        destination: `${backendUrl}/trpc/frontend/:path*`,
      },
      {
        source: "/mcp-proxy/:path*",
        destination: `${backendUrl}/mcp-proxy/:path*`,
      },
      {
        source: "/metamcp/:path*",
        destination: `${backendUrl}/metamcp/:path*`,
      },
      {
        source: "/service/:path*",
        destination: "https://metatool-service.jczstudio.workers.dev/:path*",
      },
    ]
  },
}

export default nextConfig
