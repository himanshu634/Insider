import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseExport } from './parse.js';
import { chunk, localToUtcIso, toIngest } from './toIngest.js';
import { ANDROID_EXPORT, IOS_EXPORT } from './fixtures.js';

const KEY = 'test-hmac-key';
const GROUP = '120363000000000001@g.us';
const hmac = (v: string) => createHmac('sha256', KEY).update(v).digest('hex');

describe('toIngest', () => {
  const android = toIngest(parseExport(ANDROID_EXPORT).messages, { groupJid: GROUP, hmacKey: KEY });

  it('converts IST wall-clock time to UTC', () => {
    expect(android[0]!.sent_at).toBe('2026-10-19T04:11:00.000Z'); // 19/10/26 9:41 am IST
    expect(android.at(-1)!.sent_at).toBe('2026-10-19T20:45:00.000Z'); // 20/10/26 2:15 am IST, previous UTC day
    expect(android[5]!.sent_at).toBe('2026-10-19T18:35:00.000Z'); // 20/10/26 12:05 am IST
  });

  it('treats --tz UTC as no offset', () => {
    const [m] = toIngest(parseExport('19/10/26, 9:41 am - Ramesh: hi').messages, { groupJid: GROUP, hmacKey: KEY, tz: 'UTC' });
    expect(m!.sent_at).toBe('2026-10-19T09:41:00.000Z');
    expect(localToUtcIso({ year: 2026, month: 1, day: 1, hour: 3, minute: 0, second: 0 }, 330)).toBe('2025-12-31T21:30:00.000Z');
  });

  it('fills the contract fields', () => {
    for (const m of android) {
      expect(m.stanza_id).toMatch(/^export-[0-9a-f]{40}$/);
      expect(m.sender_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(m.group_jid).toBe(GROUP);
      expect(m.is_forwarded).toBe(false);
      expect(m.quoted_stanza_id).toBeNull();
      expect(m.media).toBeNull();
    }
    expect(android[0]).toMatchObject({ sender_name: 'Ramesh Patel', type: 'text', sender_hash: hmac('Ramesh Patel') });
    expect(android[3]).toMatchObject({ type: 'image', text: 'જીરું rate sheet' });
  });

  it('hashes phone-number senders as a JID and never sends the number', () => {
    const fromAndroid = android[1]!;
    const fromIos = toIngest(parseExport(IOS_EXPORT).messages, { groupJid: GROUP, hmacKey: KEY })[4]!;
    expect(fromAndroid.sender_name).toBeNull();
    expect(fromAndroid.sender_hash).toBe(hmac('919876543210@s.whatsapp.net'));
    expect(fromIos.sender_hash).toBe(fromAndroid.sender_hash);
  });

  it('produces stable stanza IDs across re-imports and longer re-exports', () => {
    const again = toIngest(parseExport(ANDROID_EXPORT).messages, { groupJid: GROUP, hmacKey: 'other-key' });
    expect(again.map((m) => m.stanza_id)).toEqual(android.map((m) => m.stanza_id));

    const longer = ANDROID_EXPORT + '20/10/26, 9:00 am - Mahesh: Groundnut 1160\n';
    const longerIds = toIngest(parseExport(longer).messages, { groupJid: GROUP, hmacKey: KEY }).map((m) => m.stanza_id);
    expect(longerIds.slice(0, android.length)).toEqual(android.map((m) => m.stanza_id));
    expect(longerIds).toHaveLength(android.length + 1);

    expect(new Set(android.map((m) => m.stanza_id)).size).toBe(android.length);
  });

  it('changes the stanza ID when group, time, sender or text differ', () => {
    const id = (input: string, group = GROUP) =>
      toIngest(parseExport(input).messages, { groupJid: group, hmacKey: KEY })[0]!.stanza_id;
    const ref = id('19/10/26, 9:41 am - Ramesh: Castor 1290');
    expect(id('19/10/26, 9:41 am - Ramesh: Castor 1290', '120363000000000002@g.us')).not.toBe(ref);
    expect(id('19/10/26, 9:42 am - Ramesh: Castor 1290')).not.toBe(ref);
    expect(id('19/10/26, 9:41 am - Suresh: Castor 1290')).not.toBe(ref);
    expect(id('19/10/26, 9:41 am - Ramesh: Castor 1291')).not.toBe(ref);
  });

  it('rejects a bad group JID or an unknown timezone', () => {
    const msgs = parseExport('19/10/26, 9:41 am - Ramesh: hi').messages;
    expect(() => toIngest(msgs, { groupJid: '919876543210@s.whatsapp.net', hmacKey: KEY })).toThrow(/@g\.us/);
    expect(() => toIngest(msgs, { groupJid: GROUP, hmacKey: KEY, tz: 'America/New_York' })).toThrow(/unsupported --tz/);
  });
});

describe('chunk', () => {
  it('splits into batches of at most 500', () => {
    const sizes = chunk(Array.from({ length: 1201 }, (_, i) => i)).map((b) => b.length);
    expect(sizes).toEqual([500, 500, 201]);
  });
});
