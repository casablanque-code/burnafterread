import crypto from "node:crypto";

function base64url(buffer) {
  return buffer.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlToBuffer(str) {
  const base64 = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(str.length / 4) * 4, "=");
  return Buffer.from(base64, "base64");
}

export function generateKey() {
  return crypto.randomBytes(32);
}

export function decodeKey(str) {
  return base64urlToBuffer(str);
}

export async function encryptBytes(buffer, key) {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(buffer),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return {
    iv: base64url(iv),
    data: base64url(Buffer.concat([encrypted, tag]))
  };
}

export async function decryptBytes(payload, key) {
  const iv = base64urlToBuffer(payload.iv);
  const raw = base64urlToBuffer(payload.data);

  // AES-256-GCM tag is always 16 bytes appended at the end
  const TAG_LEN = 16;
  if (raw.length < TAG_LEN) {
    throw new Error("Ciphertext too short — data may be corrupt");
  }

  const ciphertext = raw.subarray(0, raw.length - TAG_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encodeKey(key) {
  return base64url(key);
}
