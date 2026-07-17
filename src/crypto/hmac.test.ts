import { describe, expect, it } from 'vitest';

import { hmacSha256, safeEqualHex, verifyHexHmac } from './hmac.js';

describe('hmac-sha256', () => {
  const secret = 'per-webhook-secret';
  const rawBody = Buffer.from('{"event":"taskStatusUpdated"}');

  it('verifies a correct hex signature over raw bytes', () => {
    const sig = hmacSha256(secret, rawBody).toString('hex');
    expect(verifyHexHmac(secret, rawBody, sig)).toBe(true);
  });

  it('rejects wrong secret, wrong body, or wrong signature', () => {
    const sig = hmacSha256(secret, rawBody).toString('hex');
    expect(verifyHexHmac('wrong-secret', rawBody, sig)).toBe(false);
    expect(verifyHexHmac(secret, Buffer.from('{}'), sig)).toBe(false);
    expect(verifyHexHmac(secret, rawBody, 'deadbeef')).toBe(false);
  });

  it('safeEqualHex is case-insensitive', () => {
    const sig = hmacSha256(secret, rawBody).toString('hex');
    expect(safeEqualHex(sig.toUpperCase(), sig)).toBe(true);
    expect(safeEqualHex(sig, sig)).toBe(true);
  });
});
