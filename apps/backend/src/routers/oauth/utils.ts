import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import express from "express"

import logger from "@/utils/logger"

/**
 * Constant-time string comparison. Returns false for non-strings or
 * length-mismatched inputs without leaking timing about the contents. Used for
 * comparing client secrets so an attacker cannot recover them byte-by-byte.
 */
export function safeCompare(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false
  const ab = Buffer.from(a, "utf8")
  const bb = Buffer.from(b, "utf8")
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// OAuth 2.0 Authorization Parameters interface
export interface OAuthParams {
  client_id: string
  redirect_uri: string
  scope?: string
  state?: string
  code_challenge?: string
  code_challenge_method?: string
}

/**
 * Generate cryptographically secure authorization code
 * Follows OAuth 2.1 security requirements
 */
export function generateSecureAuthCode(): string {
  const randomPart = randomBytes(32).toString("base64url")
  return `mcp_code_${randomPart}`
}

/**
 * Generate cryptographically secure access token
 * Follows OAuth 2.1 security requirements
 */
export function generateSecureAccessToken(): string {
  const randomPart = randomBytes(32).toString("base64url")
  return `mcp_token_${randomPart}`
}

/**
 * Generate cryptographically secure refresh token
 * Follows OAuth 2.1 security requirements
 */
export function generateSecureRefreshToken(): string {
  const randomPart = randomBytes(32).toString("base64url")
  return `mcp_refresh_${randomPart}`
}

/**
 * Generate cryptographically secure client ID
 * Follows OAuth 2.1 security requirements
 */
export function generateSecureClientId(): string {
  const randomPart = randomBytes(16).toString("base64url")
  return `mcp_client_${randomPart}`
}

/**
 * Generate cryptographically secure client secret
 * Follows OAuth 2.1 security requirements
 */
export function generateSecureClientSecret(): string {
  const randomPart = randomBytes(32).toString("base64url")
  return `mcp_secret_${randomPart}`
}

/**
 * Escape a value for safe interpolation into an HTML document body/attribute.
 * Prevents reflected markup/script injection when echoing request-controlled
 * values (e.g. `state`) back into an HTML response.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Loopback hosts may use http (native/dev clients); everything else must https. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  )
}

/**
 * Internal/reserved network targets that should never be a (non-loopback)
 * redirect destination — cloud metadata, private and link-local ranges.
 */
function isReservedHost(hostname: string): boolean {
  if (hostname === "0.0.0.0") return true
  if (hostname.startsWith("169.254.")) return true // link-local / cloud metadata
  if (hostname.startsWith("10.")) return true
  if (hostname.startsWith("192.168.")) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true // 172.16–172.31
  if (hostname.startsWith("127.")) return true // loopback handled separately
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd]/.test(hostname) || hostname.startsWith("fe80")) return true
  return false
}

/**
 * Validate redirect URI according to OAuth 2.1 security requirements.
 * Hardening is applied unconditionally (not gated on NODE_ENV): only http(s)
 * schemes, https required except for loopback, no URL fragment, and
 * private/reserved hosts blocked for non-loopback targets.
 */
export function validateRedirectUri(
  uri: string,
  allowedHosts?: string[],
): boolean {
  let parsedUri: URL
  try {
    parsedUri = new URL(uri)
  } catch {
    return false
  }

  // Only http/https — blocks javascript:, data:, file:, custom schemes.
  if (parsedUri.protocol !== "https:" && parsedUri.protocol !== "http:") {
    return false
  }

  // RFC 6749 §3.1.2: the redirect URI must not include a fragment.
  if (parsedUri.hash) {
    return false
  }

  // Strip IPv6 brackets for comparison (URL.hostname yields e.g. "[::1]").
  const hostname = parsedUri.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  const loopback = isLoopbackHost(hostname)

  // http is only allowed for loopback; all other hosts must use https.
  if (parsedUri.protocol === "http:" && !loopback) {
    return false
  }

  // Block internal/reserved targets for non-loopback hosts.
  if (!loopback && isReservedHost(hostname)) {
    return false
  }

  // Check against allowed hosts if provided
  if (allowedHosts && allowedHosts.length > 0) {
    return allowedHosts.includes(parsedUri.hostname)
  }

  return true
}

/**
 * Hash client secret for secure storage
 * Uses SHA-256 with salt
 */
export function hashClientSecret(
  secret: string,
  salt?: string,
): { hash: string; salt: string } {
  const saltToUse = salt || randomBytes(16).toString("hex")
  const hash = createHash("sha256")
    .update(secret + saltToUse)
    .digest("hex")
  return { hash, salt: saltToUse }
}

/**
 * Verify client secret against stored hash
 */
export function verifyClientSecret(
  secret: string,
  storedHash: string,
  salt: string,
): boolean {
  const { hash } = hashClientSecret(secret, salt)
  return hash === storedHash
}

/**
 * Helper function to get the correct base URL from request
 * Prioritizes APP_URL environment variable, then checks proxy headers
 */
export function getBaseUrl(req: express.Request): string {
  // Prioritize APP_URL environment variable
  if (process.env.APP_URL) {
    return process.env.APP_URL
  }

  // Check for forwarded headers from Next.js proxy
  const forwardedHost = req.headers["x-forwarded-host"] as string
  const forwardedProto = req.headers["x-forwarded-proto"] as string

  if (forwardedHost) {
    const protocol = forwardedProto || "http"
    return `${protocol}://${forwardedHost}`
  }

  // Fallback to request host
  return `${req.protocol}://${req.get("host")}`
}

/**
 * Middleware to add JSON parsing for OAuth POST endpoints
 */
export function jsonParsingMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  // Only apply JSON parsing for OAuth POST endpoints that need parsed body
  const needsJsonParsing =
    (req.path.startsWith("/oauth/") && req.method === "POST") ||
    (req.path === "/oauth/register" && req.method === "POST")

  if (needsJsonParsing) {
    return express.json({
      limit: "10mb",
      type: "application/json",
    })(req, res, next)
  }
  next()
}

/**
 * Middleware to add URL-encoded form parsing for OAuth POST endpoints
 */
export function urlencodedParsingMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  // Only apply URL-encoded parsing for OAuth POST endpoints
  const needsUrlencodedParsing =
    (req.path.startsWith("/oauth/") && req.method === "POST") ||
    (req.path === "/oauth/register" && req.method === "POST")

  if (needsUrlencodedParsing) {
    return express.urlencoded({
      extended: true,
      limit: "10mb",
    })(req, res, next)
  }
  next()
}

/**
 * Simple in-memory rate limiter for OAuth endpoints
 * In production, use Redis or similar for distributed rate limiting
 */
class RateLimiter {
  private attempts: Map<string, { count: number; resetTime: number }> =
    new Map()
  private maxAttempts: number
  private windowMs: number

  constructor(maxAttempts: number = 10, windowMs: number = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
  }

  isRateLimited(identifier: string): boolean {
    const now = Date.now()
    const record = this.attempts.get(identifier)

    if (!record || now > record.resetTime) {
      // Reset or create new record
      this.attempts.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs,
      })
      return false
    }

    if (record.count >= this.maxAttempts) {
      return true
    }

    record.count++
    return false
  }

  reset(identifier: string): void {
    this.attempts.delete(identifier)
  }

  // Clean up old entries periodically
  cleanup(): void {
    const now = Date.now()
    for (const [key, record] of this.attempts) {
      if (now > record.resetTime) {
        this.attempts.delete(key)
      }
    }
  }
}

// Create rate limiter instances
const authEndpointLimiter = new RateLimiter(20, 1 * 60 * 1000) // 20 attempts per 1 minute
const tokenEndpointLimiter = new RateLimiter(20, 1 * 60 * 1000) // 10 attempts per 1 minute

// Clean up rate limiter entries every 10 minutes
setInterval(
  () => {
    authEndpointLimiter.cleanup()
    tokenEndpointLimiter.cleanup()
  },
  10 * 60 * 1000,
)

/**
 * Rate limiting middleware for OAuth authorization endpoint
 */
export function rateLimitAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const identifier = req.ip || req.socket?.remoteAddress || "unknown"

  if (authEndpointLimiter.isRateLimited(identifier)) {
    logger.info(
      `[RATE LIMIT] Authorization endpoint rate limited for IP: ${identifier} - Too many authorization attempts`,
    )
    return res.status(429).json({
      error: "too_many_requests",
      error_description:
        "Too many authorization attempts. Please try again later.",
    })
  }

  next()
}

/**
 * Rate limiting middleware for OAuth token endpoint
 */
export function rateLimitToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const identifier = req.ip || req.socket?.remoteAddress || "unknown"

  if (tokenEndpointLimiter.isRateLimited(identifier)) {
    logger.info(
      `[RATE LIMIT] Token endpoint rate limited for IP: ${identifier} - Too many token requests`,
    )
    return res.status(429).json({
      error: "too_many_requests",
      error_description: "Too many token requests. Please try again later.",
    })
  }

  next()
}

/**
 * Security headers middleware for OAuth endpoints
 * Prevents common web vulnerabilities
 */
export function securityHeaders(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY")

  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff")

  // XSS protection
  res.setHeader("X-XSS-Protection", "1; mode=block")

  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")

  // Content Security Policy for OAuth pages
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';",
  )

  // Cache control for sensitive endpoints
  if (req.path.includes("/oauth/")) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate")
    res.setHeader("Pragma", "no-cache")
    res.setHeader("Expires", "0")
  }

  next()
}
