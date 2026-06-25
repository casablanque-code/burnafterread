import { describe, it, expect } from "vitest";
import { randomId, randomToken, sha256 } from "../worker/lib/ids";

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ALPHANUM = /^[A-Za-z0-9]+$/;

describe("randomId", () => {
  it("returns a string of default length 10", () => {
    expect(randomId()).toHaveLength(10);
  });

  it("returns a string of specified length", () => {
    expect(randomId(16)).toHaveLength(16);
  });

  it("contains only alphanumeric characters", () => {
    expect(ALPHANUM.test(randomId(50))).toBe(true);
  });

  it("generates unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomId()));
    expect(ids.size).toBe(100);
  });
});

describe("randomToken", () => {
  it("returns a base64url string", () => {
    expect(BASE64URL.test(randomToken())).toBe(true);
  });

  it("returns at least 32 characters for 32-byte token", () => {
    expect(randomToken(32).length).toBeGreaterThanOrEqual(32);
  });

  it("generates unique values", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("sha256", () => {
  it("returns a base64url string", async () => {
    const hash = await sha256("test");
    expect(BASE64URL.test(hash)).toBe(true);
  });

  it("is deterministic", async () => {
    const a = await sha256("hello");
    const b = await sha256("hello");
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", async () => {
    const a = await sha256("hello");
    const b = await sha256("world");
    expect(a).not.toBe(b);
  });

  it("produces 43-character output for SHA-256 (256 bits → base64url)", async () => {
    const hash = await sha256("anything");
    expect(hash).toHaveLength(43);
  });
});
