import type { RateLimitConfig } from '../core/types';

interface RateLimitEntry {
  requests: number[];
  windowStart: number;
}

export class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();

  constructor(private config: RateLimitConfig) {}

  async throttle(key: string): Promise<void> {
    const now = Date.now();
    let entry = this.limits.get(key);

    if (!entry) {
      entry = { requests: [], windowStart: now };
      this.limits.set(key, entry);
    }

    // Remove old requests outside the window
    const windowStart = now - this.config.windowMs;
    entry.requests = entry.requests.filter((time) => time > windowStart);

    if (entry.requests.length >= this.config.maxRequests) {
      // Calculate how long to wait
      const oldestRequest = entry.requests[0];
      const waitTime = this.config.windowMs - (now - oldestRequest);
      
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.throttle(key); // Retry after waiting
      }
    }

    entry.requests.push(now);
  }

  reset(key: string): void {
    this.limits.delete(key);
  }

  clear(): void {
    this.limits.clear();
  }
}
