import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock transitive dependencies pulled in via rate-limit.ts -> mcp-server-pool.ts
vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock("./metamcp/mcp-server-pool", () => ({
  mcpServerPool: {
    getBackgroundIdleSessionsByNamespace: vi.fn(() => new Map()),
  },
}))

import {
  deriveRateLimitKey,
  RateLimitError,
  RateLimiting,
  refillRatePerSecond,
  SlidingWindowRateLimiter,
  SlidingWindowRateLimiting,
  TokenBucketRateLimiter,
} from "./rate-limit"

describe("deriveRateLimitKey", () => {
  it("uses the trusted req.ip for the default 'ip' strategy, ignoring headers", () => {
    const key = deriveRateLimitKey(
      "ip",
      "x-forwarded-for",
      { "x-forwarded-for": "1.2.3.4" }, // attacker-controlled, must be ignored
      "5.6.7.8",
      "9.9.9.9",
    )
    expect(key).toBe("5.6.7.8")
  })

  it("falls back to the socket address when req.ip is absent (ip strategy)", () => {
    expect(
      deriveRateLimitKey("ip", "x-forwarded-for", {}, undefined, "9.9.9.9"),
    ).toBe("9.9.9.9")
  })

  it("uses the configured header only for the explicit 'header' strategy", () => {
    expect(
      deriveRateLimitKey(
        "header",
        "x-api-key",
        { "x-api-key": "k1" },
        "ip",
        "s",
      ),
    ).toBe("k1")
  })

  it("takes the first value for an array-valued header", () => {
    expect(
      deriveRateLimitKey("header", "x-fwd", { "x-fwd": ["a", "b"] }, "ip", "s"),
    ).toBe("a")
  })

  it("header strategy falls back to ip when the header is missing", () => {
    expect(deriveRateLimitKey("header", "x-fwd", {}, "5.6.7.8", "s")).toBe(
      "5.6.7.8",
    )
  })
})

describe("refillRatePerSecond", () => {
  it("derives a per-second rate from requests-per-window", () => {
    expect(refillRatePerSecond(60, 60)).toBe(1)
    expect(refillRatePerSecond(100, 10)).toBe(10)
    expect(refillRatePerSecond(30, 60)).toBe(0.5)
  })

  it("does not divide by zero when the window is zero", () => {
    expect(refillRatePerSecond(5, 0)).toBe(5)
  })

  it("refills the bucket at the configured rate, not the window length", () => {
    vi.useFakeTimers()
    try {
      // 2 requests / 2 seconds → 1 token/sec (NOT 2 tokens/sec).
      const limiter = new TokenBucketRateLimiter(2, refillRatePerSecond(2, 2))
      expect(limiter.consume()).toBe(true)
      expect(limiter.consume()).toBe(true)
      expect(limiter.consume()).toBe(false) // exhausted
      vi.advanceTimersByTime(1000) // +1s → +1 token
      expect(limiter.consume()).toBe(true)
      expect(limiter.consume()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("TokenBucketRateLimiter", () => {
  it("should allow requests within capacity", () => {
    const limiter = new TokenBucketRateLimiter(5, 1)
    expect(limiter.consume()).toBe(true)
    expect(limiter.consume()).toBe(true)
    expect(limiter.consume()).toBe(true)
  })

  it("should deny requests when tokens exhausted", () => {
    const limiter = new TokenBucketRateLimiter(2, 0)
    expect(limiter.consume()).toBe(true)
    expect(limiter.consume()).toBe(true)
    expect(limiter.consume()).toBe(false)
  })

  it("should return boolean synchronously (not a Promise)", () => {
    const limiter = new TokenBucketRateLimiter(5, 1)
    const result = limiter.consume()
    // Should be a plain boolean, not a Promise
    expect(typeof result).toBe("boolean")
    expect(result).not.toBeInstanceOf(Promise)
  })

  it("should track lastAccessed", () => {
    const limiter = new TokenBucketRateLimiter(5, 1)
    const before = Date.now()
    limiter.consume()
    expect(limiter.lastAccessed).toBeGreaterThanOrEqual(before)
  })
})

describe("SlidingWindowRateLimiter", () => {
  it("should allow requests within rate limit", () => {
    const limiter = new SlidingWindowRateLimiter(3, 60)
    expect(limiter.isAllowed()).toBe(true)
    expect(limiter.isAllowed()).toBe(true)
    expect(limiter.isAllowed()).toBe(true)
  })

  it("should deny requests exceeding rate limit", () => {
    const limiter = new SlidingWindowRateLimiter(2, 60)
    expect(limiter.isAllowed()).toBe(true)
    expect(limiter.isAllowed()).toBe(true)
    expect(limiter.isAllowed()).toBe(false)
  })

  it("should return boolean synchronously (not a Promise)", () => {
    const limiter = new SlidingWindowRateLimiter(5, 60)
    const result = limiter.isAllowed()
    expect(typeof result).toBe("boolean")
    expect(result).not.toBeInstanceOf(Promise)
  })

  it("should track lastAccessed", () => {
    const limiter = new SlidingWindowRateLimiter(5, 60)
    const before = Date.now()
    limiter.isAllowed()
    expect(limiter.lastAccessed).toBeGreaterThanOrEqual(before)
  })
})

describe("RateLimiting", () => {
  let rateLimiting: RateLimiting

  beforeEach(() => {
    rateLimiting = new RateLimiting()
  })

  it("should not have shared mutable state between requests with different endpoints", async () => {
    // This test verifies the fix for the race condition where concurrent
    // requests from different endpoints would overwrite each other's limits.
    // With the fix, maxRate/maxRateSeconds are local variables, not instance properties.
    const endpoint1 = {
      max_rate: 10,
      max_rate_seconds: 60,
      namespace_uuid: "ns-1",
      user_id: "user-1",
    }
    const endpoint2 = {
      max_rate: 1,
      max_rate_seconds: 1,
      namespace_uuid: "ns-2",
      user_id: "user-2",
    }

    // Simulate a request with endpoint1 config
    // Since there are no background idle sessions, these should pass through
    let called1 = false
    await rateLimiting.onRequest({ req: { endpoint: endpoint1 } }, async () => {
      called1 = true
    })
    expect(called1).toBe(true)

    // Simulate a request with endpoint2 config
    let called2 = false
    await rateLimiting.onRequest({ req: { endpoint: endpoint2 } }, async () => {
      called2 = true
    })
    expect(called2).toBe(true)

    // The key assertion: RateLimiting instance should NOT have maxRate/maxRateSeconds
    // as instance properties (they should be local variables)
    expect((rateLimiting as any).maxRate).toBeUndefined()
    expect((rateLimiting as any).maxRateSeconds).toBeUndefined()
  })
})

describe("SlidingWindowRateLimiting", () => {
  let slidingWindow: SlidingWindowRateLimiting

  beforeEach(() => {
    slidingWindow = new SlidingWindowRateLimiting()
  })

  it("should not have shared mutable state between requests", async () => {
    // Verify the fix: these should NOT be instance properties
    expect((slidingWindow as any).clientMaxRate).toBeUndefined()
    expect((slidingWindow as any).clientMaxRateSeconds).toBeUndefined()
    expect((slidingWindow as any).clientMaxRateStrategy).toBeUndefined()
    expect((slidingWindow as any).clientMaxRateStrategyKey).toBeUndefined()
  })
})

describe("RateLimitError", () => {
  it("should have code -32000", () => {
    const error = new RateLimitError()
    expect(error.code).toBe(-32000)
    expect(error.message).toBe("Rate limit exceeded")
  })

  it("should accept custom message", () => {
    const error = new RateLimitError("Custom rate limit")
    expect(error.message).toBe("Custom rate limit")
  })

  it("should be an instance of Error", () => {
    const error = new RateLimitError()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(RateLimitError)
  })
})
