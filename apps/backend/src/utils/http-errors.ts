import type { Response } from "express";

/**
 * Send a client-safe error response. Never serializes the raw Error object
 * (which can leak stack traces, internal params, and config) — callers should
 * have already logged the underlying error server-side. No-ops if headers were
 * already sent (common in streaming/SSE handlers).
 */
export function sendSafeError(
  res: Response,
  status: number,
  message: string,
): void {
  if (res.headersSent) return;
  res.status(status).json({ error: message });
}
