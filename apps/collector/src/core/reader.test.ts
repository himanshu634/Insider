import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildFixtureDb,
  DM,
  G1,
  G2,
  G3,
  removeTempDirs,
  TEST_HMAC_KEY,
} from '../test-support/fixture.js';
import { appleTimeToIso, guessMime, mapMessageType, WhatsAppReader } from './reader.js';
import { hashSender } from './sender-hash.js';

let reader: WhatsAppReader;

beforeAll(() => {
  reader = WhatsAppReader.open(buildFixtureDb(), { senderHmacKey: TEST_HMAC_KEY });
});

afterAll(() => {
  reader.close();
  removeTempDirs();
});

const byStanza = (jids: string[]) =>
  new Map(reader.newMessages(jids, new Map()).messages.map((m) => [m.message.stanza_id, m.message]));

describe('WhatsAppReader.groups', () => {
  it('lists the three groups with names and member counts, newest first', () => {
    expect(reader.groups()).toEqual([
      { jid: G2, name: 'Rajkot Groundnut Bazaar', member_count: 3 },
      { jid: G1, name: 'Gondal Castor Rates', member_count: 3 },
      { jid: G3, name: 'ગુજરાત મંડી ભાવ', member_count: 2 },
    ]);
  });

  it('leaves out 1:1 chats', () => {
    expect(reader.groups().map((g) => g.jid)).not.toContain(DM);
  });
});

describe('WhatsAppReader.newMessages', () => {
  it('reads every group message from the start, oldest first, and ignores 1:1 chats', () => {
    const { messages, checkpoints } = reader.newMessages([G1, G2, G3, DM], new Map());
    expect(messages).toHaveLength(18);
    expect(messages.every((m) => m.message.group_jid.endsWith('@g.us'))).toBe(true);
    expect(messages.some((m) => m.message.stanza_id.startsWith('SYNTH-DM'))).toBe(false);
    const pks = messages.map((m) => m.pk);
    expect(pks).toEqual([...pks].sort((a, b) => a - b));
    expect(checkpoints).toEqual(new Map([[G1, 19], [G2, 20], [G3, 17]]));
  });

  it('only returns messages after each group checkpoint', () => {
    const { messages, checkpoints } = reader.newMessages([G1, G2, G3], new Map([[G1, 9], [G2, 20]]));
    expect(messages.map((m) => m.message.stanza_id)).toEqual([
      'SYNTH-G3-0001',
      'SYNTH-G3-0002',
      'SYNTH-G1-0005',
      'SYNTH-G3-0003',
      'SYNTH-G1-0006',
      'SYNTH-G3-0004',
      'SYNTH-G1-0007',
    ]);
    expect(checkpoints.has(G2)).toBe(false);
  });

  it('only reads the requested groups', () => {
    const { messages } = reader.newMessages([G2], new Map());
    expect(new Set(messages.map((m) => m.groupJid))).toEqual(new Set([G2]));
    expect(messages).toHaveLength(7);
  });

  it('respects the read limit', () => {
    const { messages, checkpoints } = reader.newMessages([G1, G2, G3], new Map(), 5);
    expect(messages.map((m) => m.pk)).toEqual([1, 2, 3, 5, 6]);
    expect(checkpoints).toEqual(new Map([[G1, 3], [G2, 5], [G3, 6]]));
  });

  it('joins the sender: HMAC of the member JID plus display name', () => {
    const m = byStanza([G1, G2]);
    const kishanHash = hashSender('910000000102@s.whatsapp.net', TEST_HMAC_KEY);
    expect(m.get('SYNTH-G1-0002')).toMatchObject({
      sender_hash: kishanHash,
      sender_name: 'Kishan Traders',
      text: 'એરંડા 1250-1290 ગોંડલ',
      type: 'text',
    });
    // Same person in another group → same hash.
    expect(m.get('SYNTH-G2-0003')?.sender_hash).toBe(kishanHash);
    expect(m.get('SYNTH-G1-0002')?.sender_hash).toMatch(/^[0-9a-f]{64}$/);
    // The plain JID never appears in the payload.
    expect(JSON.stringify([...m.values()])).not.toContain('910000000102');
  });

  it('hashes "self" for own messages and the group JID for system events', () => {
    const m = byStanza([G2, G3]);
    expect(m.get('SYNTH-G2-0004')).toMatchObject({
      sender_hash: hashSender('self', TEST_HMAC_KEY),
      sender_name: null,
    });
    expect(m.get('SYNTH-G3-0003')).toMatchObject({
      type: 'system',
      text: null,
      sender_hash: hashSender(G3, TEST_HMAC_KEY),
    });
  });

  it('joins the media item of an image', () => {
    const m = byStanza([G2]);
    expect(m.get('SYNTH-G2-0003')).toMatchObject({
      type: 'image',
      text: 'aaj na bhav',
      media: { mime: 'image/jpeg', size_bytes: 84213, file_name: 'SYNTH-0001.jpg' },
    });
    expect(m.get('SYNTH-G2-0002')?.media).toBeNull();
  });

  it('hands back the local media item and path, which are never part of the upload', () => {
    const read = reader.newMessages([G2], new Map()).messages;
    const image = read.find((r) => r.message.stanza_id === 'SYNTH-G2-0003');
    expect(image?.media).toEqual({ itemPk: 1, localPath: 'Media/120363000000000002@g.us/0/a/SYNTH-0001.jpg' });
    expect(JSON.stringify(image?.message)).not.toContain('Media/');
    expect(read.find((r) => r.message.stanza_id === 'SYNTH-G2-0002')?.media).toBeNull();
  });

  it('re-reads media paths by media item', () => {
    expect(reader.mediaLocalPaths([1, 1, 999])).toEqual(
      new Map([[1, 'Media/120363000000000002@g.us/0/a/SYNTH-0001.jpg']]),
    );
    expect(reader.mediaLocalPaths([])).toEqual(new Map());
  });

  it('converts Apple-epoch dates to ISO UTC', () => {
    const m = byStanza([G1, G2]);
    expect(m.get('SYNTH-G1-0001')?.sent_at).toBe('2026-10-19T03:30:00.000Z');
    expect(m.get('SYNTH-G2-0007')?.sent_at).toBe('2026-10-19T04:10:00.000Z');
  });

  it('maps quoted messages, forwarded flags and stickers', () => {
    const m = byStanza([G1, G3]);
    expect(m.get('SYNTH-G1-0005')?.quoted_stanza_id).toBe('SYNTH-G1-0002');
    expect(m.get('SYNTH-G1-0001')?.quoted_stanza_id).toBeNull();
    expect(m.get('SYNTH-G1-0004')?.is_forwarded).toBe(true);
    expect(m.get('SYNTH-G3-0002')?.is_forwarded).toBe(true);
    expect(m.get('SYNTH-G1-0004')?.text).toBe(m.get('SYNTH-G3-0002')?.text);
    expect(m.get('SYNTH-G1-0003')?.is_forwarded).toBe(false);
    expect(m.get('SYNTH-G1-0007')?.type).toBe('sticker');
  });

  it('needs the HMAC key', () => {
    const noKey = new WhatsAppReader(reader.database);
    expect(() => noKey.newMessages([G1], new Map())).toThrow(/senderHmacKey/);
  });
});

describe('helpers', () => {
  it('appleTimeToIso handles the epoch and fractions', () => {
    expect(appleTimeToIso(0)).toBe('2001-01-01T00:00:00.000Z');
    expect(appleTimeToIso(814073400.25)).toBe('2026-10-19T03:30:00.250Z');
  });

  it('mapMessageType falls back to other', () => {
    expect(mapMessageType(0)).toBe('text');
    expect(mapMessageType(8)).toBe('document');
    expect(mapMessageType(999)).toBe('other');
    expect(mapMessageType(null)).toBe('other');
  });

  it('guessMime uses the extension, then the message type', () => {
    expect(guessMime('a/b/rates.PDF', 'document')).toBe('application/pdf');
    expect(guessMime(null, 'image')).toBe('image/jpeg');
    expect(guessMime(null, 'document')).toBe('application/octet-stream');
  });
});
