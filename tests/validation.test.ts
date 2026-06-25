import { describe, it, expect } from "vitest";
import { validateCreate } from "../worker/lib/validation";

const BASE = {
  ciphertext: "abc",
  ttl_seconds: 3600,
  views: 1,
  kind: "text",
  size_bytes: 100,
};

describe("validateCreate", () => {
  it("accepts a valid minimal request", () => {
    expect(validateCreate(BASE)).not.toBeNull();
  });

  it("returns null for null input", () => {
    expect(validateCreate(null)).toBeNull();
  });

  it("returns null when ciphertext is missing", () => {
    expect(validateCreate({ ...BASE, ciphertext: 123 })).toBeNull();
  });

  it("returns null when kind is invalid", () => {
    expect(validateCreate({ ...BASE, kind: "image" })).toBeNull();
  });

  it("accepts kind=file", () => {
    expect(validateCreate({ ...BASE, kind: "file" })).not.toBeNull();
  });

  // ttl_seconds
  it("rejects ttl_seconds below 60", () => {
    expect(validateCreate({ ...BASE, ttl_seconds: 59 })).toBeNull();
  });

  it("accepts ttl_seconds = 60 (lower bound)", () => {
    expect(validateCreate({ ...BASE, ttl_seconds: 60 })).not.toBeNull();
  });

  it("accepts ttl_seconds = 7 days (upper bound)", () => {
    expect(validateCreate({ ...BASE, ttl_seconds: 7 * 24 * 3600 })).not.toBeNull();
  });

  it("rejects ttl_seconds above 7 days", () => {
    expect(validateCreate({ ...BASE, ttl_seconds: 7 * 24 * 3600 + 1 })).toBeNull();
  });

  it("rejects ttl_seconds = 999999999", () => {
    expect(validateCreate({ ...BASE, ttl_seconds: 999999999 })).toBeNull();
  });

  // views
  it("rejects views = 0", () => {
    expect(validateCreate({ ...BASE, views: 0 })).toBeNull();
  });

  it("accepts views = 1 (lower bound)", () => {
    expect(validateCreate({ ...BASE, views: 1 })).not.toBeNull();
  });

  it("accepts views = 10 (upper bound)", () => {
    expect(validateCreate({ ...BASE, views: 10 })).not.toBeNull();
  });

  it("rejects views = 11", () => {
    expect(validateCreate({ ...BASE, views: 11 })).toBeNull();
  });

  it("rejects non-integer views", () => {
    expect(validateCreate({ ...BASE, views: 1.5 })).toBeNull();
  });

  // size_bytes
  it("rejects size above 5MB", () => {
    expect(validateCreate({ ...BASE, size_bytes: 5 * 1024 * 1024 + 1 })).toBeNull();
  });

  it("accepts size = 5MB exactly", () => {
    expect(validateCreate({ ...BASE, size_bytes: 5 * 1024 * 1024 })).not.toBeNull();
  });

  // paranoid flag
  it("defaults paranoid to false", () => {
    const result = validateCreate(BASE);
    expect(result?.paranoid).toBe(false);
  });

  it("passes paranoid=true through", () => {
    const result = validateCreate({ ...BASE, paranoid: true });
    expect(result?.paranoid).toBe(true);
  });
});
