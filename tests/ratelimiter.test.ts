import { describe, it, expect } from "vitest";

// Isolated sliding window logic extracted from RateLimiter DO
// Testing the algorithm independently of Cloudflare runtime

const LIMIT = 20;
const WINDOW_MS = 60_000;

function createRateLimiter() {
  const hits = new Map<string, number[]>();

  return {
    check(ip: string, now: number): boolean {
      const windowStart = now - WINDOW_MS;
      const timestamps = (hits.get(ip) ?? []).filter((t) => t > windowStart);
      timestamps.push(now);
      hits.set(ip, timestamps);
      return timestamps.length <= LIMIT;
    },
  };
}

describe("RateLimiter sliding window", () => {
  it("allows requests up to the limit", () => {
    const rl = createRateLimiter();
    const now = Date.now();
    for (let i = 0; i < LIMIT; i++) {
      expect(rl.check("1.2.3.4", now + i)).toBe(true);
    }
  });

  it("blocks the request that exceeds the limit", () => {
    const rl = createRateLimiter();
    const now = Date.now();
    for (let i = 0; i < LIMIT; i++) {
      rl.check("1.2.3.4", now + i);
    }
    expect(rl.check("1.2.3.4", now + LIMIT)).toBe(false);
  });

  it("allows requests again after the window expires", () => {
    const rl = createRateLimiter();
    const now = Date.now();
    for (let i = 0; i < LIMIT; i++) {
      rl.check("1.2.3.4", now + i);
    }
    // advance past the window
    const later = now + WINDOW_MS + 1000;
    expect(rl.check("1.2.3.4", later)).toBe(true);
  });

  it("tracks different IPs independently", () => {
    const rl = createRateLimiter();
    const now = Date.now();
    for (let i = 0; i < LIMIT; i++) {
      rl.check("1.1.1.1", now + i);
    }
    // different IP should still be allowed
    expect(rl.check("2.2.2.2", now)).toBe(true);
  });

  it("evicts timestamps outside the window on each check", () => {
    const rl = createRateLimiter();
    const now = 1_000_000;
    // fill limit
    for (let i = 0; i < LIMIT; i++) {
      rl.check("5.5.5.5", now + i);
    }
    // next request over limit
    expect(rl.check("5.5.5.5", now + LIMIT)).toBe(false);

    // move window so all previous timestamps are evicted
    const future = now + WINDOW_MS + 5000;
    expect(rl.check("5.5.5.5", future)).toBe(true);
  });
});
