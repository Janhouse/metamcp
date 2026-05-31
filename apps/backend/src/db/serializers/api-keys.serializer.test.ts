import { describe, expect, it } from "vitest"

import { ApiKeysSerializer, maskApiKey } from "./api-keys.serializer"

const mk = (over: Partial<Record<string, unknown>>) => ({
  uuid: "u",
  name: "n",
  key: "sk_mt_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  created_at: new Date("2020-01-01T00:00:00Z"),
  is_active: true,
  user_id: "owner",
  ...over,
})

describe("maskApiKey", () => {
  it("keeps only a short non-secret hint", () => {
    const masked = maskApiKey("sk_mt_ABCDEFGHIJKLMNOP1234")
    expect(masked).toBe("sk_mt_…1234")
    expect(masked).not.toContain("ABCDEFGHIJKLMNOP")
  })
  it("fully masks short/empty values", () => {
    expect(maskApiKey("")).toBe("")
    expect(maskApiKey("short")).toBe("••••")
  })
})

describe("ApiKeysSerializer.serializeApiKeyList masking", () => {
  const own = mk({ uuid: "own", user_id: "me" })
  const other = mk({ uuid: "other", user_id: "someone" })
  const pub = mk({ uuid: "pub", user_id: null })

  it("shows the full key only for owned keys to a non-admin", () => {
    const out = ApiKeysSerializer.serializeApiKeyList([own, other, pub], {
      requesterId: "me",
      isAdmin: false,
    })
    expect(out[0].key).toBe(own.key) // owned → full
    expect(out[1].key).toBe("sk_mt_…6789") // others' → masked
    expect(out[2].key).toBe("sk_mt_…6789") // public → masked
  })

  it("shows all full keys to an admin", () => {
    const out = ApiKeysSerializer.serializeApiKeyList([other, pub], {
      requesterId: "admin",
      isAdmin: true,
    })
    expect(out[0].key).toBe(other.key)
    expect(out[1].key).toBe(pub.key)
  })

  it("masks everything when no requester context is provided", () => {
    const out = ApiKeysSerializer.serializeApiKeyList([own])
    expect(out[0].key).toBe("sk_mt_…6789")
  })
})
