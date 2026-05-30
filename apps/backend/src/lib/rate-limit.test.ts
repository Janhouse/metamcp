import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock transitive dependencies pulled in via rate-limit.ts -> mcp-server-pool.ts
vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./metamcp/mcp-server-pool", () => ({
  mcpServerPool: {
    getBackgroundIdleSessionsByNamespace: vi.fn(() => new Map()),
  },
}));

import {
  RateLimitError,
  RateLimiting,
  SlidingWindowRateLimiter,
  SlidingWindowRateLimiting,
  TokenBucketRateLimiter,
} from "./rate-limit";

describe("TokenBucketRateLimiter", () => {
  it("should allow requests within capacity", () => {
    const limiter = new TokenBucketRateLimiter(5, 1);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
  });

  it("should deny requests when tokens exhausted", () => {
    const limiter = new TokenBucketRateLimiter(2, 0);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(false);
  });

  it("should return boolean synchronously (not a Promise)", () => {
    const limiter = new TokenBucketRateLimiter(5, 1);
    const result = limiter.consume();
    // Should be a plain boolean, not a Promise
    expect(typeof result).toBe("boolean");
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("should track lastAccessed", () => {
    const limiter = new TokenBucketRateLimiter(5, 1);
    const before = Date.now();
    limiter.consume();
    expect(limiter.lastAccessed).toBeGreaterThanOrEqual(before);
  });
});

describe("SlidingWindowRateLimiter", () => {
  it("should allow requests within rate limit", () => {
    const limiter = new SlidingWindowRateLimiter(3, 60);
    expect(limiter.isAllowed()).toBe(true);
    expect(limiter.isAllowed()).toBe(true);
    expect(limiter.isAllowed()).toBe(true);
  });

  it("should deny requests exceeding rate limit", () => {
    const limiter = new SlidingWindowRateLimiter(2, 60);
    expect(limiter.isAllowed()).toBe(true);
    expect(limiter.isAllowed()).toBe(true);
    expect(limiter.isAllowed()).toBe(false);
  });

  it("should return boolean synchronously (not a Promise)", () => {
    const limiter = new SlidingWindowRateLimiter(5, 60);
    const result = limiter.isAllowed();
    expect(typeof result).toBe("boolean");
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("should track lastAccessed", () => {
    const limiter = new SlidingWindowRateLimiter(5, 60);
    const before = Date.now();
    limiter.isAllowed();
    expect(limiter.lastAccessed).toBeGreaterThanOrEqual(before);
  });
});

describe("RateLimiting", () => {
  let rateLimiting: RateLimiting;

  beforeEach(() => {
    rateLimiting = new RateLimiting();
  });

  it("should not have shared mutable state between requests with different endpoints", async () => {
    // This test verifies the fix for the race condition where concurrent
    // requests from different endpoints would overwrite each other's limits.
    // With the fix, maxRate/maxRateSeconds are local variables, not instance properties.
    const endpoint1 = {
      max_rate: 10,
      max_rate_seconds: 60,
      namespace_uuid: "ns-1",
      user_id: "user-1",
    };
    const endpoint2 = {
      max_rate: 1,
      max_rate_seconds: 1,
      namespace_uuid: "ns-2",
      user_id: "user-2",
    };

    // Simulate a request with endpoint1 config
    // Since there are no background idle sessions, these should pass through
    let called1 = false;
    await rateLimiting.onRequest({ req: { endpoint: endpoint1 } }, async () => {
      called1 = true;
    });
    expect(called1).toBe(true);

    // Simulate a request with endpoint2 config
    let called2 = false;
    await rateLimiting.onRequest({ req: { endpoint: endpoint2 } }, async () => {
      called2 = true;
    });
    expect(called2).toBe(true);

    // The key assertion: RateLimiting instance should NOT have maxRate/maxRateSeconds
    // as instance properties (they should be local variables)
    expect((rateLimiting as any).maxRate).toBeUndefined();
    expect((rateLimiting as any).maxRateSeconds).toBeUndefined();
  });
});

describe("SlidingWindowRateLimiting", () => {
  let slidingWindow: SlidingWindowRateLimiting;

  beforeEach(() => {
    slidingWindow = new SlidingWindowRateLimiting();
  });

  it("should not have shared mutable state between requests", async () => {
    // Verify the fix: these should NOT be instance properties
    expect((slidingWindow as any).clientMaxRate).toBeUndefined();
    expect((slidingWindow as any).clientMaxRateSeconds).toBeUndefined();
    expect((slidingWindow as any).clientMaxRateStrategy).toBeUndefined();
    expect((slidingWindow as any).clientMaxRateStrategyKey).toBeUndefined();
  });
});

describe("RateLimitError", () => {
  it("should have code -32000", () => {
    const error = new RateLimitError();
    expect(error.code).toBe(-32000);
    expect(error.message).toBe("Rate limit exceeded");
  });

  it("should accept custom message", () => {
    const error = new RateLimitError("Custom rate limit");
    expect(error.message).toBe("Custom rate limit");
  });

  it("should be an instance of Error", () => {
    const error = new RateLimitError();
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RateLimitError);
  });
});
