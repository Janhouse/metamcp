// Export tRPC setup

// Export all zod types for convenience
export * from "@repo/zod-types"
// Export router creators
export { createAppRouter, createFrontendRouter } from "./router"
export { createConfigRouter, createMcpServersRouter } from "./routers/frontend"
export type { BaseContext } from "./trpc"
export {
  adminProcedure,
  baseProcedure,
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  router,
} from "./trpc"
