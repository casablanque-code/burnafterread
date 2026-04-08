import { json, error } from "./lib/responses";
import { randomId, randomToken, sha256 } from "./lib/ids";
import { validateCreate } from "./lib/validation";
import { DropAccessCoordinator } from "./durable/DropAccessCoordinator";

export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  DROP_COORDINATOR: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export { DropAccessCoordinator };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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
    return env.ASSETS.fetch(request);
  },
};