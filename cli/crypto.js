import crypto from "node:crypto";

function base64url(buffer) {
  return buffer.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateKey() {
  return crypto.randomBytes(32);
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

export function encodeKey(key) {
  return base64url(key);
}