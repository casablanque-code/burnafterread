// worker/durable/RateLimiter.ts
//
// Sliding window rate limiter: max N requests per IP per window (seconds).
// State is in-memory — resets if the DO hibernates (rare, acceptable for
// rate limiting). No D1/R2 needed.

const LIMIT = 20;
const WINDOW_MS = 60_000;

export class RateLimiter {
  state: DurableObjectState;
  // ip -> array of request timestamps within the current window
  private hits: Map<string, number[]> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/check") {
      const { ip } = (await request.json()) as { ip: string };

      const now = Date.now();
      const windowStart = now - WINDOW_MS;

      // evict timestamps outside the window
      const timestamps = (this.hits.get(ip) ?? []).filter(t => t > windowStart);
      timestamps.push(now);
      this.hits.set(ip, timestamps);

      const allowed = timestamps.length <= LIMIT;

      return new Response(JSON.stringify({ allowed }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  }
}
