// worker/durable/DropAccessCoordinator.ts

interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
}

interface DropRow {
  id: string;
  r2_key: string;
  kind: string;
  expire_at: string;
  views_left: number;
  paranoid: number; // 0 | 1 in SQLite
  delete_token_hash: string;
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

    if (url.pathname === "/consume") {
      const body = (await request.json()) as { id: string };
      const id = body.id;

      return this.state.blockConcurrencyWhile(async () => {
        const drop = await this.env.DB.prepare(
          `SELECT * FROM drops WHERE id = ?`
        )
          .bind(id)
          .first<DropRow>();

        if (!drop) {
          return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }

        const expireTime = new Date(drop.expire_at).getTime();
        if (expireTime < Date.now()) {
          await this.deleteDrop(drop);

          if (drop.paranoid) {
            return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
          }

          return new Response(JSON.stringify({ error: "expired" }), { status: 410 });
        }

        if (drop.views_left <= 0) {
          if (drop.paranoid) {
            return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
          }

          return new Response(JSON.stringify({ error: "burned" }), { status: 410 });
        }

        const newViews = drop.views_left - 1;

        await this.env.DB.prepare(
          `UPDATE drops SET views_left = ? WHERE id = ?`
        )
          .bind(newViews, id)
          .run();

        const obj = await this.env.BLOBS.get(drop.r2_key);

        if (!obj) {
          return new Response(JSON.stringify({ error: "missing_blob" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const ciphertext = await obj.text();

        if (drop.paranoid) {
          await this.deleteDrop(drop);
        } else if (newViews <= 0) {
          await this.deleteDrop(drop);
        }

        return new Response(
          JSON.stringify({ ciphertext, kind: drop.kind }),
          { headers: { "content-type": "application/json" } }
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
          .first<DropRow>();

        if (!drop) {
          return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }

        const providedHash = await this.sha256(delete_token);

        if (!this.timingSafeEqual(providedHash, drop.delete_token_hash)) {
          return new Response(JSON.stringify({ error: "forbidden" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }

        await this.deleteDrop(drop);

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

  async deleteDrop(drop: DropRow): Promise<void> {
    await this.env.DB.prepare(`DELETE FROM drops WHERE id = ?`)
      .bind(drop.id)
      .run();

    await this.env.BLOBS.delete(drop.r2_key);
  }
}
