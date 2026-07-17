import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { config } from '../config/index.js';

import { signTelegramJwt, validateInitData } from './init-data.js';

const BOT_TOKEN = config.telegram.botToken;

/** Build initData the way Telegram does, so validation round-trips. */
function buildInitData(botToken: string, user: object, authDate: number): string {
  const params = new URLSearchParams();
  params.set('query_id', 'AAHdF6IQAAAAAN0XohDhrOrc');
  params.set('user', JSON.stringify(user));
  params.set('auth_date', String(authDate));

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

describe('initData validation', () => {
  const now = Math.floor(Date.now() / 1000);

  it('accepts a correctly signed, fresh initData', () => {
    const initData = buildInitData(BOT_TOKEN, { id: 12345, username: 'igor', first_name: 'Igor' }, now);
    const result = validateInitData(initData, BOT_TOKEN);
    expect(result?.user.id).toBe(12345);
    expect(result?.user.username).toBe('igor');
  });

  it('rejects a wrong bot token', () => {
    const initData = buildInitData(BOT_TOKEN, { id: 1 }, now);
    expect(validateInitData(initData, 'wrong:token')).toBeNull();
  });

  it('rejects a tampered initData', () => {
    const initData = buildInitData(BOT_TOKEN, { id: 1 }, now) + '&extra=bad';
    expect(validateInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it('rejects stale initData (outside the window)', () => {
    const initData = buildInitData(BOT_TOKEN, { id: 1 }, now - 7200); // 2h ago
    expect(validateInitData(initData, BOT_TOKEN, 3600)).toBeNull();
  });
});

describe('signTelegramJwt', () => {
  it('issues a 3-part JWT carrying the telegram_id claim', () => {
    const token = signTelegramJwt(4242);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    expect(payload.telegram_id).toBe(4242);
    expect(payload.role).toBe('authenticated');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});
