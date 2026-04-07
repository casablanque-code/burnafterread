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
        // 1. читаем id
        const body = (await request.json()) as { id: string };
        const id = body.id;
  
        // 2. читаем запись из D1
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
  
        // 3. проверяем TTL
        const expireTime = new Date((drop as any).expire_at).getTime();
        if (expireTime < Date.now()) {
          await this.deleteDrop(drop as any);
          return new Response(JSON.stringify({ error: "expired" }), {
            status: 410,
            headers: { "content-type": "application/json" },
          });
        }
  
        // 4. проверяем просмотры
        if ((drop as any).views_left <= 0) {
          return new Response(JSON.stringify({ error: "burned" }), {
            status: 410,
            headers: { "content-type": "application/json" },
          });
        }
  
        // 5. уменьшаем просмотры
        const newViews = (drop as any).views_left - 1;
  
        await this.env.DB.prepare(
          `UPDATE drops SET views_left = ? WHERE id = ?`
        )
          .bind(newViews, id)
          .run();
  
        // 6. читаем ciphertext из R2
        const obj = await this.env.BLOBS.get((drop as any).r2_key);
  
        if (!obj) {
          return new Response(JSON.stringify({ error: "missing_blob" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
  
        const ciphertext = await obj.text();
  
        // 7. если последний просмотр — удаляем
        if (newViews <= 0) {
          await this.deleteDrop(drop as any);
        }
  
        // 8. возвращаем данные
        return new Response(
          JSON.stringify({
            ciphertext,
            kind: (drop as any).kind,
          }),
          {
            headers: { "content-type": "application/json" },
          }
        );
      }
  
      return new Response("not found", { status: 404 });
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