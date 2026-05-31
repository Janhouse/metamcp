/**
 * Parse the TRUST_PROXY env var into an Express `trust proxy` setting.
 *
 * Express uses this to compute req.ip from X-Forwarded-For. Getting it right
 * matters for rate limiting: if the app trusts forwarded headers when it should
 * not, clients can spoof their IP; if it doesn't when it should, all clients
 * collapse to the proxy's IP.
 *
 * Accepts: "true"/"false" (boolean), a hop count ("1"), or a string such as a
 * subnet/IP list or a preset like "loopback". Defaults to false (trust nobody).
 */
export function parseTrustProxy(
  value: string | undefined,
): boolean | number | string {
  if (value === undefined || value.trim() === "") return false
  const v = value.trim()
  if (v === "true") return true
  if (v === "false") return false
  if (/^\d+$/.test(v)) return Number(v)
  return v
}
