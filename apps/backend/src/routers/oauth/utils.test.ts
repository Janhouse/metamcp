import { describe, expect, it } from "vitest"

import { escapeHtml, safeCompare, validateRedirectUri } from "./utils"

describe("validateRedirectUri", () => {
  it("accepts https URLs", () => {
    expect(validateRedirectUri("https://app.example.com/cb")).toBe(true)
  })
  it("accepts http only for loopback", () => {
    expect(validateRedirectUri("http://localhost:3000/cb")).toBe(true)
    expect(validateRedirectUri("http://127.0.0.1/cb")).toBe(true)
    expect(validateRedirectUri("http://app.example.com/cb")).toBe(false)
  })
  it("rejects dangerous schemes", () => {
    expect(validateRedirectUri("javascript:alert(1)")).toBe(false)
    expect(validateRedirectUri("data:text/html,<script>")).toBe(false)
    expect(validateRedirectUri("file:///etc/passwd")).toBe(false)
  })
  it("rejects URLs with a fragment", () => {
    expect(validateRedirectUri("https://app.example.com/cb#x")).toBe(false)
  })
  it("blocks cloud-metadata and private ranges (non-loopback), regardless of NODE_ENV", () => {
    expect(validateRedirectUri("https://169.254.169.254/")).toBe(false)
    expect(validateRedirectUri("https://10.0.0.5/cb")).toBe(false)
    expect(validateRedirectUri("https://192.168.1.5/cb")).toBe(false)
    expect(validateRedirectUri("https://172.16.0.1/cb")).toBe(false)
    expect(validateRedirectUri("https://0.0.0.0/cb")).toBe(false)
  })
  it("does not over-block public 172.x addresses", () => {
    expect(validateRedirectUri("https://172.15.0.1/cb")).toBe(true)
    expect(validateRedirectUri("https://172.32.0.1/cb")).toBe(true)
  })
  it("honors an explicit allowedHosts list", () => {
    expect(
      validateRedirectUri("https://evil.com/cb", ["app.example.com"]),
    ).toBe(false)
    expect(
      validateRedirectUri("https://app.example.com/cb", ["app.example.com"]),
    ).toBe(true)
  })
  it("rejects malformed URLs", () => {
    expect(validateRedirectUri("not a url")).toBe(false)
  })
})

describe("safeCompare", () => {
  it("returns true for identical strings", () => {
    expect(safeCompare("mcp_secret_abc", "mcp_secret_abc")).toBe(true)
  })
  it("returns false for differing strings", () => {
    expect(safeCompare("mcp_secret_abc", "mcp_secret_abd")).toBe(false)
  })
  it("returns false for length mismatch", () => {
    expect(safeCompare("short", "longer-value")).toBe(false)
  })
  it("returns false for null/undefined inputs", () => {
    expect(safeCompare(undefined, "x")).toBe(false)
    expect(safeCompare("x", null)).toBe(false)
    expect(safeCompare(null, null)).toBe(false)
  })
})

describe("escapeHtml", () => {
  it("escapes HTML metacharacters", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    )
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;")
  })

  it("neutralizes an injected state value (no raw markup survives)", () => {
    const malicious = `</code></p><script>fetch('/x')</script>`
    const out = escapeHtml(malicious)
    expect(out).not.toContain("<script>")
    expect(out).not.toContain("</p>")
    expect(out).toContain("&lt;script&gt;")
  })

  it("handles null/undefined as empty string", () => {
    expect(escapeHtml(undefined)).toBe("")
    expect(escapeHtml(null)).toBe("")
  })
})
