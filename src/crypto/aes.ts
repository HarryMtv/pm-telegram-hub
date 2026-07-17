import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV — recommended size for GCM

let cachedKey: Buffer | null = null;

/** The 32-byte AES key, derived from the hex ENCRYPTION_KEY (never leaves the app). */
function key(): Buffer {
  if (!cachedKey) cachedKey = Buffer.from(config.encryptionKeyHex, 'hex');
  return cachedKey;
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM. Output format is `iv:tag:ciphertext`,
 * each component base64-encoded (spec §3.2). A fresh IV is used per record.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString('base64')).join(':');
}

/** Decrypt an `iv:tag:ciphertext` (base64) string back to UTF-8. Throws on tampering. */
export function decrypt(serialized: string): string {
  const parts = serialized.split(':');
  if (parts.length !== 3) throw new Error('invalid ciphertext format (expected iv:tag:ciphertext)');
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Encrypt any JSON-serializable value (e.g. opaque provider credentials). */
export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

/** Decrypt a JSON payload produced by `encryptJson`. */
export function decryptJson<T = unknown>(serialized: string): T {
  return JSON.parse(decrypt(serialized)) as T;
}
