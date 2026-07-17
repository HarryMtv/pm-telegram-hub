import type { RateLimitConfig } from './types.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Simple token bucket. `take()` waits until a token is available, providing
 * steady-state throttling for 'fixed'-rpm providers. For 'dynamic' providers the
 * bucket is effectively unlimited (the HTTP client honors `Retry-After`).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = now;
    }
  }

  async take(cost = 1): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= cost) {
        this.tokens -= cost;
        return;
      }
      const deficit = cost - this.tokens;
      const waitMs = Math.ceil(deficit / this.refillPerMs);
      await sleep(Math.max(waitMs, 1));
    }
  }
}

/**
 * Per-connection buckets. Limiters are keyed by connection id so the bucket
 * survives across events for the same connection (e.g. a Wrike batch enriching
 * many tasks shares one budget).
 */
class RateLimiterRegistry {
  private buckets = new Map<string, TokenBucket>();

  forConnection(connectionId: string, cfg: RateLimitConfig): TokenBucket {
    let bucket = this.buckets.get(connectionId);
    if (!bucket) {
      if (cfg.mode === 'fixed' && cfg.rpm) {
        // Capacity = rpm allows an initial burst, then steady at rpm/min.
        bucket = new TokenBucket(Math.max(cfg.rpm, 1), cfg.rpm / 60_000);
      } else {
        // Dynamic: no steady-state cap — rely on Retry-After in the HTTP client.
        bucket = new TokenBucket(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
      }
      this.buckets.set(connectionId, bucket);
    }
    return bucket;
  }

  clear(): void {
    this.buckets.clear();
  }
}

export const rateLimiters = new RateLimiterRegistry();
