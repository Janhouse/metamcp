import {
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

// Define the OAuth router with procedure definitions
// The actual implementation will be provided by the backend
export const createOAuthRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    get: (
      input: z.infer<typeof GetOAuthSessionRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof GetOAuthSessionResponseSchema>>;
    upsert: (
      input: z.infer<typeof UpsertOAuthSessionRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>>;
  },
) => {
  return router({
    // Protected: Get OAuth session by MCP server UUID (with ownership check)
    get: protectedProcedure
      .input(GetOAuthSessionRequestSchema)
      .output(GetOAuthSessionResponseSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.get(input, (ctx as any).user.id);
      }),

    // Protected: Upsert OAuth session (with ownership check)
    upsert: protectedProcedure
      .input(UpsertOAuthSessionRequestSchema)
      .output(UpsertOAuthSessionResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.upsert(input, (ctx as any).user.id);
      }),
  });
};
