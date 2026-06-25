export interface CreateDropRequest {
    ciphertext: string;
    ttl_seconds: number;
    views: number;
    kind: "text" | "file";
    size_bytes: number;
    paranoid?: boolean;
  }
  
  export function validateCreate(body: any): CreateDropRequest | null {
    if (!body) return null;
  
    if (typeof body.ciphertext !== "string") return null;
    if (typeof body.ttl_seconds !== "number") return null;
    if (typeof body.views !== "number") return null;
    if (!["text", "file"].includes(body.kind)) return null;
    if (typeof body.size_bytes !== "number") return null;

    if (body.size_bytes > 5 * 1024 * 1024) return null;
    if (body.ttl_seconds < 60 || body.ttl_seconds > 7 * 24 * 3600) return null;
    if (!Number.isInteger(body.views) || body.views < 1 || body.views > 10) return null;
  
    return {
      ciphertext: body.ciphertext,
      ttl_seconds: body.ttl_seconds,
      views: body.views,
      kind: body.kind,
      size_bytes: body.size_bytes,
      paranoid: !!body.paranoid,
    };
  }