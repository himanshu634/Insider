import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contentCluster, waMessage } from '../src/db/schema.js';
import { senderHash } from '../src/security.js';
import { setup } from './helpers.js';

const msg = (stanza: string, group = '120363000000000001@g.us', text: string | null = 'એરંડા 1250-1290 ગોંડલ') => ({
  stanza_id: stanza,
  group_jid: group,
  sender_hash: senderHash('919800000001@s.whatsapp.net', 'test-key'),
  sender_name: 'Trader A',
  sent_at: '2026-10-19T05:30:00Z',
  type: 'text',
  text,
  is_forwarded: false,
});

describe('POST /v1/ingest/messages', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => (t = await setup()));
  afterEach(() => t.close());

  it('requires a valid device token', async () => {
    const json = { messages: [msg('A1')] };
    expect((await t.request('/v1/ingest/messages', { method: 'POST', json, device: false })).status).toBe(401);
    const wrong = await t.request('/v1/ingest/messages', {
      method: 'POST',
      json,
      device: false,
      headers: { authorization: 'Bearer wrong' },
    });
    expect(wrong.status).toBe(401);
  });

  it('is idempotent on group + stanza ID', async () => {
    const json = { messages: [msg('A1'), msg('A2', undefined, 'Good morning 🙏')] };
    const first = await (await t.request('/v1/ingest/messages', { method: 'POST', json })).json();
    expect(first).toMatchObject({ accepted: 2, duplicate: 0, rejected: 0 });

    const again = await (await t.request('/v1/ingest/messages', { method: 'POST', json })).json();
    expect(again).toMatchObject({ accepted: 0, duplicate: 2 });
    expect(new Set(again.results.map((r: { status: string }) => r.status))).toEqual(new Set(['duplicate']));
    expect(await t.db.select().from(waMessage)).toHaveLength(2);
  });

  it('joins forwards of one post into a single content cluster', async () => {
    const json = {
      messages: [
        msg('B1', '120363000000000001@g.us', 'Forwarded\nએરંડા 1250-1290 ગોંડલ 🌱'),
        msg('B2', '120363000000000002@g.us', 'એરંડા   1250-1290 ગોંડલ'),
      ],
    };
    const res = await (await t.request('/v1/ingest/messages', { method: 'POST', json })).json();
    expect(res.accepted).toBe(2);
    const clusters = await t.db.select().from(contentCluster);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.groupCount).toBe(2);
  });

  it('rejects bodies that break the spec', async () => {
    const tooMany = { messages: Array.from({ length: 501 }, (_, i) => msg(`C${i}`)) };
    expect((await t.request('/v1/ingest/messages', { method: 'POST', json: tooMany })).status).toBe(422);
    const badJid = { messages: [msg('D1', 'not-a-group')] };
    expect((await t.request('/v1/ingest/messages', { method: 'POST', json: badJid })).status).toBe(422);
  });
});
