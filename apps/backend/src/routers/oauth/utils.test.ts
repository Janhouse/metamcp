import { describe, expect, it } from "vitest";

import { escapeHtml, safeCompare } from "./utils";

describe("safeCompare", () => {
  it("returns true for identical strings", () => {
    expect(safeCompare("mcp_secret_abc", "mcp_secret_abc")).toBe(true);
  });
  it("returns false for differing strings", () => {
    expect(safeCompare("mcp_secret_abc", "mcp_secret_abd")).toBe(false);
  });
  it("returns false for length mismatch", () => {
    expect(safeCompare("short", "longer-value")).toBe(false);
  });
  it("returns false for null/undefined inputs", () => {
    expect(safeCompare(undefined, "x")).toBe(false);
    expect(safeCompare("x", null)).toBe(false);
    expect(safeCompare(null, null)).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapes HTML metacharacters", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });

  it("neutralizes an injected state value (no raw markup survives)", () => {
    const malicious = `</code></p><script>fetch('/x')</script>`;
    const out = escapeHtml(malicious);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("</p>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("handles null/undefined as empty string", () => {
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(null)).toBe("");
  });
});
