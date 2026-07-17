import { describe, expect, it } from 'vitest';

import { decrypt, decryptJson, encrypt, encryptJson } from './aes.js';

describe('aes-256-gcm', () => {
  it('round-trips a UTF-8 string', () => {
    const ciphertext = encrypt('hello world');
    expect(ciphertext.split(':')).toHaveLength(3); // iv:tag:ciphertext
    expect(decrypt(ciphertext)).toBe('hello world');
  });

  it('uses a fresh IV per encryption', () => {
    const a = encrypt('same payload');
    const b = encrypt('same payload');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same payload');
    expect(decrypt(b)).toBe('same payload');
  });

  it('round-trips opaque JSON credentials', () => {
    const credentials = { token: 'pk_abc_123', nested: { x: 1 } };
    expect(decryptJson(encryptJson(credentials))).toEqual(credentials);
  });

  it('rejects tampered ciphertext via the auth tag', () => {
    const [iv, tag, data] = encrypt('secret').split(':') as [string, string, string];
    const buf = Buffer.from(data, 'base64');
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff; // flip last byte
    const tampered = [iv, tag, buf.toString('base64')].join(':');
    expect(() => decrypt(tampered)).toThrow();
  });
});
