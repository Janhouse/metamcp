import { createAuthClient } from "better-auth/react"

import { getAppUrl } from "./env"

// No generic-OAuth client plugin: as of better-auth 1.7 the server-side
// `genericOAuth` plugin registers its providers as first-class social
// providers, so OIDC sign-in goes through the core `signIn.social` /
// `callback/:id` endpoints that the base client already exposes.
export const authClient = createAuthClient({
  baseURL: getAppUrl(),
}) as ReturnType<typeof createAuthClient>
