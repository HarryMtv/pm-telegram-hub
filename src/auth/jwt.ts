import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../config/index.js';

export interface VerifiedJwt {
  telegramId: number;
  exp: number;
}

/** Verify a JWT issued by `signTelegramJwt`; returns the telegram_id claim if valid+live. */
export function verifyTelegramJwt(token: string): VerifiedJwt | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const data = `${headerB64}.${payloadB64}`;
  const expected = createHmac('sha256', config.jwtSecret).update(data).digest();
  const actual = Buffer.from(sigB64, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let payload: { telegram_id?: number; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.telegram_id !== 'number' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { telegramId: payload.telegram_id, exp: payload.exp };
}

/** Extract & verify the Bearer token from an Authorization header; returns telegram_id. */
export function telegramIdFromAuth(authHeader: string | string[] | undefined): number | null {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw?.startsWith('Bearer ')) return null;
  const verified = verifyTelegramJwt(raw.slice('Bearer '.length));
  return verified?.telegramId ?? null;
}
