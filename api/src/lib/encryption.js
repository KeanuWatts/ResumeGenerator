import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const KEY_LEN = 32;

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error("ENCRYPTION_KEY must be set and at least 16 characters for API key encryption");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

/**
 * Encrypt a plaintext string. Output is base64( iv || authTag || ciphertext ).
 * @param {string} plaintext
 * @returns {string} base64-encoded ciphertext bundle
 */
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === "") return "";
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString("base64");
}

/**
 * Decrypt a value produced by encrypt().
 * @param {string} encoded - base64( iv || authTag || ciphertext )
 * @returns {string} plaintext
 */
export function decrypt(encoded) {
  if (encoded == null || encoded === "") return "";
  const key = getKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LEN + AUTH_TAG_LEN) return "";
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}
