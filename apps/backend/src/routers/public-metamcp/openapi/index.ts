// Main entry point for OpenAPI router module

export { lookupEndpoint } from "../../../middleware/lookup-endpoint-middleware"
export { createMiddlewareEnabledHandlers } from "./handlers"
export { default as openApiRouter } from "./routes"
// Export utilities for potential reuse
export { generateOpenApiSchema } from "./schema-generator"
export { executeToolWithMiddleware } from "./tool-execution"
export * from "./types"
