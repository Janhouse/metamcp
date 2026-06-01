import { describe, expect, it } from "vitest"

import { assertSecureAuthSecret } from "./secret-validation"

describe("assertSecureAuthSecret", () => {
  it("accepts a strong unique secret and returns it", () => {
    const strong = "Zm9vYmFyYmF6cXV1eA-randomish-48-chars-long-value"
    expect(assertSecureAuthSecret(strong)).toBe(strong)
  })

  it("throws when missing", () => {
    expect(() => assertSecureAuthSecret(undefined)).toThrow(/required/i)
    expect(() => assertSecureAuthSecret("")).toThrow(/required/i)
  })

  it("throws on the shipped placeholder default", () => {
    expect(() =>
      assertSecureAuthSecret("your-super-secret-key-change-this-in-production"),
    ).toThrow(/default/i)
  })

  it("throws on other well-known weak values", () => {
    expect(() => assertSecureAuthSecret("changeme")).toThrow(/default/i)
    expect(() => assertSecureAuthSecret("secret")).toThrow(/default/i)
  })

  it("throws when too short", () => {
    expect(() => assertSecureAuthSecret("abc123")).toThrow(/short/i)
  })
})
