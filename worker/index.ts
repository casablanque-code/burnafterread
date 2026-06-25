import { json, error } from "./lib/responses";
import { randomId, randomToken, sha256 } from "./lib/ids";
import { validateCreate } from "./lib/validation";
import { DropAccessCoordinator } from "./durable/DropAccessCoordinator";
import { RateLimiter } from "./durable/RateLimiter";

export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  DROP_COORDINATOR: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export { DropAccessCoordinator, RateLimiter };

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "clipboard-write=(self)",
};

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // RATE LIMIT — apply to all /api/* routes, keyed by IP
    if (url.pathname.startsWith("/api/")) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      // all IPs share one DO instance (singleton by fixed name)
      const rlId = env.RATE_LIMITER.idFromName("global");
      const rl = env.RATE_LIMITER.get(rlId);
      const rlRes = await rl.fetch("http://rl/check", {
        method: "POST",
        body: JSON.stringify({ ip }),
      });
      const { allowed } = (await rlRes.json()) as { allowed: boolean };
      if (!allowed) {
        return error("too many requests", 429);
      }
    }

    // GET drop (через DO)
    if (url.pathname.startsWith("/api/drops/") && request.method === "GET") {
      const id = url.pathname.split("/").pop();

      const objId = env.DROP_COORDINATOR.idFromName(id!);
      const stub = env.DROP_COORDINATOR.get(objId);

      const response = await stub.fetch("http://do/consume", {
        method: "POST",
        body: JSON.stringify({ id }),
      });

      return response;
    }

    // DELETE drop (revoke via delete token)
    if (url.pathname.startsWith("/api/drops/") && request.method === "DELETE") {
      const id = url.pathname.split("/").pop();

      if (!id) {
        return error("missing drop id", 400);
      }

      let delete_token: string;
      try {
        const body = await request.json() as { delete_token?: string };
        if (typeof body.delete_token !== "string" || !body.delete_token) {
          return error("missing delete_token", 400);
        }
        delete_token = body.delete_token;
      } catch {
        return error("invalid request body", 400);
      }

      const objId = env.DROP_COORDINATOR.idFromName(id);
      const stub = env.DROP_COORDINATOR.get(objId);

      const response = await stub.fetch("http://do/revoke", {
        method: "POST",
        body: JSON.stringify({ id, delete_token }),
      });

      return response;
    }

    // HEALTH
    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    // CREATE DROP
    if (url.pathname === "/api/drops" && request.method === "POST") {
      try {
        const body = await request.json();
        const data = validateCreate(body);

        if (!data) {
          return error("invalid request", 400);
        }

        // generate ids
        const id = randomId(10);
        const deleteToken = randomToken(32);
        const deleteTokenHash = await sha256(deleteToken);

        const now = Date.now();
        const expireAt = new Date(now + data.ttl_seconds * 1000).toISOString();

        const r2Key = `drops/${id}.bin`;

        // store ciphertext in R2
        await env.BLOBS.put(r2Key, data.ciphertext, {
          httpMetadata: {
            contentType: "application/octet-stream",
          },
        });

        // store metadata in D1
        await env.DB.prepare(`
          INSERT INTO drops (
            id,
            r2_key,
            kind,
            size_bytes,
            views_left,
            expire_at,
            delete_token_hash,
            paranoid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            id,
            r2Key,
            data.kind,
            data.size_bytes,
            data.views,
            expireAt,
            deleteTokenHash,
            data.paranoid ? 1 : 0
          )
          .run();

        return json({
          id,
          delete_token: deleteToken
        });

      } catch {
        return new Response(
          JSON.stringify({ error: "internal_error" }),
          {
            status: 500,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          }
        );
      }
    }

    // STATIC
    const assetResponse = await env.ASSETS.fetch(request);
    return withSecurityHeaders(assetResponse);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    // find all expired drops
    const expired = await env.DB.prepare(
      `SELECT id, r2_key FROM drops WHERE expire_at < datetime('now')`
    ).all();

    if (!expired.results?.length) return;

    for (const drop of expired.results as { id: string; r2_key: string }[]) {
      // delete from R2
      await env.BLOBS.delete(drop.r2_key);

      // delete from D1
      await env.DB.prepare(`DELETE FROM drops WHERE id = ?`)
        .bind(drop.id)
        .run();
    }
  },
};