import { describe, expect, it } from "vitest";

import { escapeHtml } from "./utils";

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
