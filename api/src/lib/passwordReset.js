import crypto from "crypto";

const TOKEN_BYTES = 32;
const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/**
 * Generate a secure random token and its hash for storage.
 * @returns {{ token: string, tokenHash: string }}
 */
export function createResetToken() {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

/**
 * @returns {number} expiry timestamp (ms)
 */
export function getResetTokenExpiry() {
  return Date.now() + EXPIRY_MS;
}

/**
 * Hash a token the same way we store it (for lookup).
 * @param {string} token - Plain token
 * @returns {string} hex hash
 */
export function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Verify plain token against stored hash.
 * @param {string} token - Plain token from email/link
 * @param {string} tokenHash - Stored hash
 * @returns {boolean}
 */
export function verifyResetToken(token, tokenHash) {
  if (!token || !tokenHash) return false;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(tokenHash, "hex"));
}
