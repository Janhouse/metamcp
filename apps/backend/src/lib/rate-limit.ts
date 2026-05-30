// rateLimiting.ts
// Rate limiting for protecting MCP servers from abuse

import { Request } from "express";

import logger from "../utils/logger";
import { mcpServerPool } from "./metamcp/mcp-server-pool";

type Context = { req: Request };
type CallNext = (context: Context) => Promise<unknown>;

export class RateLimitError extends Error {
  public code: number;

  constructor(message: string = "Rate limit exceeded") {
    super(message);
    this.code = -32000;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Token bucket implementation for rate limiting.
 */
export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRate: number;
  private tokens: number;
  private lastRefill: number;
  public lastAccessed: number;

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now() / 1000; // seconds
    this.lastAccessed = Date.now();
  }

  consume(tokens: number = 1): boolean {
    const now = Date.now() / 1000;
    const elapsed = now - this.lastRefill;

    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillRate,
    );
    this.lastRefill = now;
    this.lastAccessed = Date.now();
    logger.debug("tokens", this.tokens);

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }
}

/**
 * Sliding window rate limiter.
 */
export class SlidingWindowRateLimiter {
  private clientMaxRate: number;
  private clientMaxRateSeconds: number;
  private requests: number[] = [];
  public lastAccessed: number;

  constructor(clientMaxRate: number, clientMaxRateSeconds: number) {
    this.clientMaxRate = clientMaxRate;
    this.clientMaxRateSeconds = clientMaxRateSeconds;
    this.lastAccessed = Date.now();
  }

  isAllowed(): boolean {
    const now = Date.now() / 1000;
    const cutoff = now - this.clientMaxRateSeconds;
    // Remove old requests
    this.requests = this.requests.filter((t) => t >= cutoff);
    this.lastAccessed = Date.now();
    if (this.requests.length < this.clientMaxRate) {
      this.requests.push(now);
      return true;
    }
    return false;
  }
}

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Rate limiting (token bucket).
 * Instance properties that vary per-request are read as local variables
 * to prevent race conditions when the singleton is shared across requests.
 */
export class RateLimiting {
  private limiters: Map<string, TokenBucketRateLimiter>;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.limiters = new Map();
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      CLEANUP_INTERVAL_MS,
    );
  }

  onRequest(context: Context, callNext: CallNext): Promise<unknown> {
    const { endpoint } = context.req;
    const { user_id, namespace_uuid } = endpoint;
    const maxRate = endpoint.max_rate ?? 0;
    const maxRateSeconds = endpoint.max_rate_seconds ?? 0;

    const backgroundIdleSessions =
      mcpServerPool.getBackgroundIdleSessionsByNamespace();
    let limiter = this.limiters.get(namespace_uuid);

    if (backgroundIdleSessions.size > 0) {
      if (
        backgroundIdleSessions.get(namespace_uuid)?.get("status") === "created"
      ) {
        if (!backgroundIdleSessions.get(namespace_uuid)?.has(user_id)) {
          backgroundIdleSessions
            .get(namespace_uuid)
            ?.set(user_id, "initialized");
          if (!limiter) {
            this.limiters.set(
              namespace_uuid,
              new TokenBucketRateLimiter(maxRate, maxRateSeconds),
            );
            limiter = this.limiters.get(namespace_uuid);
          }
        }
      }

      const allowed = limiter?.consume();
      if (!allowed) {
        throw new RateLimitError(`Rate limit exceeded`);
      }
    }
    return callNext(context);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, limiter] of this.limiters) {
      if (now - limiter.lastAccessed > STALE_THRESHOLD_MS) {
        this.limiters.delete(key);
      }
    }
  }
}

/**
 * Sliding window rate limiting.
 * Instance properties that vary per-request are read as local variables
 * to prevent race conditions when the singleton is shared across requests.
 */
export class SlidingWindowRateLimiting {
  private limiters: Map<string, Map<string, SlidingWindowRateLimiter>>;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.limiters = new Map();
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      CLEANUP_INTERVAL_MS,
    );
  }

  onRequest(context: Context, callNext: CallNext): Promise<unknown> {
    const { endpoint, socket, headers } = context.req;
    const { namespace_uuid } = endpoint;
    const clientMaxRate = endpoint.client_max_rate;
    const clientMaxRateSeconds = endpoint.client_max_rate_seconds;
    const _clientMaxRateStrategy =
      endpoint.client_max_rate_strategy === ""
        ? "ip"
        : endpoint.client_max_rate_strategy;
    const clientMaxRateStrategyKey =
      endpoint.client_max_rate_strategy_key === ""
        ? "x-forwarded-for"
        : endpoint.client_max_rate_strategy_key;

    const backgroundIdleSessions =
      mcpServerPool.getBackgroundIdleSessionsByNamespace();
    const key = headers[clientMaxRateStrategyKey] || socket.remoteAddress;

    let limiter = this.limiters.get(key);

    if (backgroundIdleSessions.size > 0) {
      if (
        backgroundIdleSessions.get(namespace_uuid)?.get("status") === "created"
      ) {
        if (!backgroundIdleSessions.get(namespace_uuid)?.has(key)) {
          backgroundIdleSessions.get(namespace_uuid)?.set(key, "initialized");
          if (!limiter) {
            this.limiters.set(
              key,
              new Map().set(
                namespace_uuid,
                new SlidingWindowRateLimiter(
                  clientMaxRate,
                  clientMaxRateSeconds,
                ),
              ),
            );
            limiter = this.limiters.get(key);
          } else {
            if (!limiter.has(namespace_uuid)) {
              limiter.set(
                namespace_uuid,
                new SlidingWindowRateLimiter(
                  clientMaxRate,
                  clientMaxRateSeconds,
                ),
              );
            }
          }
        }
      }

      const slidingWindowLimiter = limiter?.get(namespace_uuid);
      if (slidingWindowLimiter) {
        const allowed = slidingWindowLimiter?.isAllowed();
        if (!allowed) {
          throw new RateLimitError(
            `Rate limit exceeded: ${clientMaxRate} requests per ${clientMaxRateSeconds} second/s`,
          );
        }
      }
    }

    return callNext(context);
  }

  onResponse(context: Context, callNext: CallNext): Promise<unknown> {
    return callNext(context);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, innerMap] of this.limiters) {
      for (const [ns, limiter] of innerMap) {
        if (now - limiter.lastAccessed > STALE_THRESHOLD_MS) {
          innerMap.delete(ns);
        }
      }
      if (innerMap.size === 0) {
        this.limiters.delete(key);
      }
    }
  }
}
