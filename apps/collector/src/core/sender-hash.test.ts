import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashSender } from './sender-hash.js';

describe('hashSender', () => {
  const jid = '910000000101@s.whatsapp.net';

  it('is HMAC-SHA256 hex of the JID', () => {
    const expected = createHmac('sha256', 'k').update(jid).digest('hex');
    expect(hashSender(jid, 'k')).toBe(expected);
    expect(hashSender(jid, 'k')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches a known vector', () => {
    // RFC 4231 test case 2: key "Jefe", data "what do ya want for nothing?"
    expect(hashSender('what do ya want for nothing?', 'Jefe')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('depends on the key and the JID', () => {
    expect(hashSender(jid, 'a')).not.toBe(hashSender(jid, 'b'));
    expect(hashSender(jid, 'a')).not.toBe(hashSender('910000000102@s.whatsapp.net', 'a'));
  });

  it('refuses an empty key', () => {
    expect(() => hashSender(jid, '')).toThrow(/SENDER_HMAC_KEY/);
  });
});
