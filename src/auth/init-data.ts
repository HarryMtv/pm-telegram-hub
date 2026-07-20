import { createHmac } from 'node:crypto';

import { config } from '../config/index.js';

const AUTH_WINDOW_SEC = 60 * 60; // ~1 hour

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: number;
}

/**
 * Validate Telegram Mini App `initData` (spec §7.2). Signature:
 *   secret = HMAC_SHA256("WebAppData", BOT_TOKEN)
 *   hash   = HMAC_SHA256(secret, data_check_string)
 * where data_check_string is every key=value (except `hash`) sorted, joined by \n.
 * Rejects if the signature mismatches or auth_date is outside the window.
 */
export function validateInitData(
  initData: string,
  botToken = config.telegram.botToken,
  maxAgeSec = AUTH_WINDOW_SEC,
): ValidatedInitData | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date') ?? NaN);
  if (!hash || !Number.isFinite(authDate)) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > maxAgeSec) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (computed !== hash) return null;

  const userRaw = params.get('user');
  let user: TelegramUser;
  try {
    user = userRaw ? (JSON.parse(userRaw) as TelegramUser) : { id: 0 };
  } catch {
    return null;
  }
  if (!user.id) return null;
  return { user, authDate };
}

/** Sign a short-lived HS256 JWT carrying the `telegram_id` claim (Supabase RLS).
 * TTL defaults to `JWT_TTL_SECONDS` (independent of the initData validity window). */
export function signTelegramJwt(telegramId: number, ttlSec = config.jwtTtlSeconds): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'pm-telegram-hub',
    iat: now,
    exp: now + ttlSec,
    telegram_id: telegramId,
    // Supabase-friendly claims; RLS reads auth.jwt() ->> 'telegram_id'.
    role: 'authenticated',
    aud: 'authenticated',
  };
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const data = `${enc(header)}.${enc(payload)}`;
  const signature = createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
  return `${data}.${signature}`;
}
