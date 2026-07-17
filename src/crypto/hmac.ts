import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 digest of `data` keyed by `secret`. */
export function hmacSha256(secret: string, data: Buffer | string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

/** Constant-time comparison of two equal-length buffers; false otherwise. */
export function safeEqualBuffers(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time comparison of two hex-encoded digests (case-insensitive). */
export function safeEqualHex(actual: string, expected: string): boolean {
  const a = Buffer.from(actual.toLowerCase(), 'hex');
  const b = Buffer.from(expected.toLowerCase(), 'hex');
  return safeEqualBuffers(a, b);
}

/**
 * Verify a webhook HMAC-SHA256 signature in constant time.
 *
 * @param secret   shared secret (per-webhook, decrypted from the `webhooks` table)
 * @param rawBody  original raw request bytes (never re-serialized JSON)
 * @param expected expected digest, hex-encoded (e.g. ClickUp `X-Signature`,
 *                 Jira `X-Hub-Signature` after stripping the `sha256=` prefix)
 */
export function verifyHexHmac(secret: string, rawBody: Buffer, expected: string): boolean {
  const computed = hmacSha256(secret, rawBody).toString('hex');
  return safeEqualHex(computed, expected);
}
