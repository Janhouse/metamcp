/**
 * Known insecure placeholder values that have shipped in example configs and
 * docker-compose defaults. Booting with any of these means session cookies and
 * tokens can be forged by anyone, so we refuse to start.
 */
export const INSECURE_DEFAULT_AUTH_SECRETS = new Set<string>([
  "your-super-secret-key-change-this-in-production",
  "change-this-in-production",
  "secret",
  "changeme",
])

const MIN_AUTH_SECRET_LENGTH = 16

/**
 * Validate BETTER_AUTH_SECRET. Throws when it is missing, a well-known
 * placeholder, or too short to be a meaningful secret. Returns the secret on
 * success so callers can assign it directly.
 */
export function assertSecureAuthSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET environment variable is required")
  }
  if (INSECURE_DEFAULT_AUTH_SECRETS.has(secret)) {
    throw new Error(
      "BETTER_AUTH_SECRET is set to a well-known default value. Set a unique, " +
        "randomly generated secret (e.g. `openssl rand -base64 48`).",
    )
  }
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET is too short (min ${MIN_AUTH_SECRET_LENGTH} chars). ` +
        "Generate a strong value, e.g. `openssl rand -base64 48`.",
    )
  }
  return secret
}
