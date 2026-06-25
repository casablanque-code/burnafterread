export interface CreateDropRequest {
  ciphertext: string;
  ttl_seconds: number;
  views: number;
  kind: "text" | "file";
  size_bytes: number;
  paranoid?: boolean;
}

export function validateCreate(body: unknown): CreateDropRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  if (typeof b.ciphertext !== "string") return null;
  if (typeof b.ttl_seconds !== "number") return null;
  if (typeof b.views !== "number") return null;
  if (b.kind !== "text" && b.kind !== "file") return null;
  if (typeof b.size_bytes !== "number") return null;

  if (b.size_bytes > 5 * 1024 * 1024) return null;
  if (b.ttl_seconds < 60 || b.ttl_seconds > 7 * 24 * 3600) return null;
  if (!Number.isInteger(b.views) || b.views < 1 || b.views > 10) return null;

  return {
    ciphertext: b.ciphertext,
    ttl_seconds: b.ttl_seconds,
    views: b.views,
    kind: b.kind,
    size_bytes: b.size_bytes,
    paranoid: !!b.paranoid,
  };
}
