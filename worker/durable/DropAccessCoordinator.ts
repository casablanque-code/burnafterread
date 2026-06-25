// worker/durable/DropAccessCoordinator.ts

interface Env {
    DB: D1Database;
    BLOBS: R2Bucket;
  }
  
  export class DropAccessCoordinator {
    state: DurableObjectState;
    env: Env;
  
    constructor(state: DurableObjectState, env: Env) {
      this.state = state;
      this.env = env;
    }
  
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      // основной эндпоинт
      if (url.pathname === "/consume") {
        const body = (await request.json()) as { id: string };
        const id = body.id;

        return this.state.blockConcurrencyWhile(async () => {
          // 1. читаем запись из D1
          const drop = await this.env.DB.prepare(
            `SELECT * FROM drops WHERE id = ?`
          )
            .bind(id)
            .first();

          if (!drop) {
            return new Response(JSON.stringify({ error: "not_found" }), {
              status: 404,
              headers: { "content-type": "application/json" },
            });
          }

          // 2. проверяем TTL
          const expireTime = new Date((drop as any).expire_at).getTime();
          if (expireTime < Date.now()) {
            await this.deleteDrop(drop as any);

            if ((drop as any).paranoid) {
              return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
            }

            return new Response(JSON.stringify({ error: "expired" }), { status: 410 });
          }

          // 3. проверяем просмотры
          if ((drop as any).views_left <= 0) {
            if ((drop as any).paranoid) {
              return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
            }

            return new Response(JSON.stringify({ error: "burned" }), { status: 410 });
          }

          // 4. уменьшаем просмотры
          const newViews = (drop as any).views_left - 1;

          await this.env.DB.prepare(
            `UPDATE drops SET views_left = ? WHERE id = ?`
          )
            .bind(newViews, id)
            .run();

          // 5. читаем ciphertext из R2
          const obj = await this.env.BLOBS.get((drop as any).r2_key);

          if (!obj) {
            return new Response(JSON.stringify({ error: "missing_blob" }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }

          const ciphertext = await obj.text();

          // 6. если последний просмотр — удаляем
          if ((drop as any).paranoid) {
            // в paranoid режиме удаляем ВСЕГДА
            await this.deleteDrop(drop as any);
          } else if (newViews <= 0) {
            await this.deleteDrop(drop as any);
          }

          // 7. возвращаем данные
          return new Response(
            JSON.stringify({
              ciphertext,
              kind: (drop as any).kind,
            }),
            {
              headers: { "content-type": "application/json" },
            }
          );
        });
      }

      if (url.pathname === "/revoke") {
        const body = (await request.json()) as { id: string; delete_token: string };
        const { id, delete_token } = body;

        if (!id || !delete_token) {
          return new Response(JSON.stringify({ error: "invalid_request" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        return this.state.blockConcurrencyWhile(async () => {
          const drop = await this.env.DB.prepare(
            `SELECT * FROM drops WHERE id = ?`
          )
            .bind(id)
            .first();

          if (!drop) {
            return new Response(JSON.stringify({ error: "not_found" }), {
              status: 404,
              headers: { "content-type": "application/json" },
            });
          }

          // timing-safe compare: hash the provided token and compare digests
          const providedHash = await this.sha256(delete_token);
          const storedHash = (drop as any).delete_token_hash as string;

          if (!this.timingSafeEqual(providedHash, storedHash)) {
            return new Response(JSON.stringify({ error: "forbidden" }), {
              status: 403,
              headers: { "content-type": "application/json" },
            });
          }

          await this.deleteDrop(drop as any);

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        });
      }

      return new Response("not found", { status: 404 });
    }

    private async sha256(input: string): Promise<string> {
      const data = new TextEncoder().encode(input);
      const hash = await crypto.subtle.digest("SHA-256", data);
      return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }

    // constant-time string comparison to prevent timing attacks
    private timingSafeEqual(a: string, b: string): boolean {
      const enc = new TextEncoder();
      const ab = enc.encode(a);
      const bb = enc.encode(b);
      if (ab.length !== bb.length) return false;
      let diff = 0;
      for (let i = 0; i < ab.length; i++) {
        diff |= ab[i] ^ bb[i];
      }
      return diff === 0;
    }

    async deleteDrop(drop: any) {
      // удаляем из D1
      await this.env.DB.prepare(
        `DELETE FROM drops WHERE id = ?`
      )
        .bind(drop.id)
        .run();
  
      // удаляем из R2
      await this.env.BLOBS.delete(drop.r2_key);
    }
  }