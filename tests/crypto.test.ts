import { describe, it, expect } from "vitest";
import {
  generateKeyBytes,
  encryptText,
  decryptText,
  encryptBytes,
  decryptBytes,
  encodeKeyForUrl,
  decodeKeyFromUrl,
} from "../src/lib/crypto";

describe("crypto: text roundtrip", () => {
  it("encrypts and decrypts text correctly", async () => {
    const key = generateKeyBytes();
    const payload = await encryptText("hello world", key);
    const result = await decryptText(payload, key);
    expect(result).toBe("hello world");
  });

  it("handles empty string", async () => {
    const key = generateKeyBytes();
    const payload = await encryptText("", key);
    const result = await decryptText(payload, key);
    expect(result).toBe("");
  });

  it("handles unicode text", async () => {
    const key = generateKeyBytes();
    const text = "Привет мир 🔐";
    const payload = await encryptText(text, key);
    const result = await decryptText(payload, key);
    expect(result).toBe(text);
  });

  it("handles long text", async () => {
    const key = generateKeyBytes();
    const text = "a".repeat(100_000);
    const payload = await encryptText(text, key);
    const result = await decryptText(payload, key);
    expect(result).toBe(text);
  });

  it("payload has v=1 and alg=AES-GCM", async () => {
    const key = generateKeyBytes();
    const payload = await encryptText("test", key);
    expect(payload.v).toBe(1);
    expect(payload.alg).toBe("AES-GCM");
  });

  it("iv is different on each encryption (random)", async () => {
    const key = generateKeyBytes();
    const a = await encryptText("same text", key);
    const b = await encryptText("same text", key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("throws on wrong key", async () => {
    const key = generateKeyBytes();
    const wrongKey = generateKeyBytes();
    const payload = await encryptText("secret", key);
    await expect(decryptText(payload, wrongKey)).rejects.toThrow();
  });

  it("throws on tampered ciphertext", async () => {
    const key = generateKeyBytes();
    const payload = await encryptText("secret", key);
    const tampered = { ...payload, data: payload.data.slice(0, -4) + "AAAA" };
    await expect(decryptText(tampered, key)).rejects.toThrow();
  });

  it("throws on unsupported payload version", async () => {
    const key = generateKeyBytes();
    const payload = await encryptText("test", key);
    // @ts-expect-error intentional
    const badVersion = { ...payload, v: 2 };
    await expect(decryptText(badVersion, key)).rejects.toThrow("Unsupported payload format");
  });
});

describe("crypto: binary roundtrip", () => {
  it("encrypts and decrypts ArrayBuffer correctly", async () => {
    const key = generateKeyBytes();
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const payload = await encryptBytes(original.buffer, key);
    const decrypted = await decryptBytes(payload, key);
    expect(new Uint8Array(decrypted)).toEqual(original);
  });

  it("throws on wrong key for binary", async () => {
    const key = generateKeyBytes();
    const wrongKey = generateKeyBytes();
    const data = new Uint8Array([10, 20, 30]).buffer;
    const payload = await encryptBytes(data, key);
    await expect(decryptBytes(payload, wrongKey)).rejects.toThrow();
  });
});

describe("crypto: key encoding", () => {
  it("encodes and decodes key correctly", () => {
    const key = generateKeyBytes();
    const encoded = encodeKeyForUrl(key);
    const decoded = decodeKeyFromUrl(encoded);
    expect(decoded).toEqual(key);
  });

  it("encoded key is 43 base64url characters", () => {
    const key = generateKeyBytes();
    const encoded = encodeKeyForUrl(key);
    expect(encoded).toHaveLength(43);
    expect(/^[A-Za-z0-9_-]{43}$/.test(encoded)).toBe(true);
  });

  it("generateKeyBytes returns 32 bytes", () => {
    const key = generateKeyBytes();
    expect(key).toHaveLength(32);
  });
});
