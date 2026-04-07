// src/lib/crypto.ts

export interface EncryptedPayloadV1 {
    v: 1;
    alg: "AES-GCM";
    iv: string;
    data: string;
  }
  
  function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
  
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
  
  function base64UrlToBytes(input: string): Uint8Array {
    const base64 = input
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(input.length / 4) * 4, "=");
  
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
  
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  
    return bytes;
  }
  
  export function generateKeyBytes(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }
  
  async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "raw",
        rawKey.buffer as ArrayBuffer,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
  }
  
  export async function encryptText(
    plaintext: string,
    rawKey: Uint8Array
  ): Promise<EncryptedPayloadV1> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await importAesKey(rawKey);
    const encoded = new TextEncoder().encode(plaintext);
  
    const encrypted = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv.buffer as ArrayBuffer,
        },
        key,
        encoded
      );
  
    return {
      v: 1,
      alg: "AES-GCM",
      iv: bytesToBase64Url(iv),
      data: bytesToBase64Url(new Uint8Array(encrypted)),
    };
  }
  
  export async function decryptText(
    payload: EncryptedPayloadV1,
    rawKey: Uint8Array
  ): Promise<string> {
    if (payload.v !== 1 || payload.alg !== "AES-GCM") {
      throw new Error("Unsupported payload format");
    }
  
    const iv = base64UrlToBytes(payload.iv);
    const data = base64UrlToBytes(payload.data);
    const key = await importAesKey(rawKey);
  
    const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv.buffer as ArrayBuffer,
        },
        key,
        data.buffer as ArrayBuffer
      );
  
    return new TextDecoder().decode(decrypted);
  }
  
  export function encodeKeyForUrl(rawKey: Uint8Array): string {
    return bytesToBase64Url(rawKey);
  }
  
  export function decodeKeyFromUrl(encodedKey: string): Uint8Array {
    return base64UrlToBytes(encodedKey);
  }