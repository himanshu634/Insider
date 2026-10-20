import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validatorFor } from '../src/contract.js';
import {
  commodity,
  market,
  priceObservation,
  unit,
  waGroup,
  waMedia,
  waMessage,
} from '../src/db/schema.js';
import { setup } from './helpers.js';

// 20 Oct 2026, 11:30 IST.
const NOW = new Date('2026-10-20T06:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('chats and the per-chat message feed', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let ids: { gondal: number; rajkot: number; quiet: number; unwatched: number };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    t = await setup();
    const groups = await t.db
      .insert(waGroup)
      .values([
        { jid: 'g1@g.us', name: 'Gondal Castor Rates', isWatched: true, memberCount: 146, primaryCommodities: ['castor'] },
        { jid: 'g2@g.us', name: 'Rajkot Groundnut Bazaar', isWatched: true },
        { jid: 'g3@g.us', name: 'Unjha Mandi Updates', isWatched: true },
        { jid: 'g4@g.us', name: 'Family', isWatched: false },
      ])
      .returning({ id: waGroup.id });
    ids = { gondal: groups[0]!.id, rajkot: groups[1]!.id, quiet: groups[2]!.id, unwatched: groups[3]!.id };
  });

  afterEach(() => {
    vi.useRealTimers();
    return t.close();
  });

  const addMessage = async (groupId: number, stanzaId: string, sentAt: Date, text: string | null, type: 'text' | 'image' = 'text') => {
    const [row] = await t.db
      .insert(waMessage)
      .values({ groupId, stanzaId, senderHash: 'h', senderName: 'Ramesh Bhai', sentAt, type, text })
      .returning({ id: waMessage.id });
    return row!.id;
  };

  const addObservation = async (messageId: number, status: 'auto' | 'needs_review' | 'rejected' = 'auto') => {
    const [castor] = await t.db.select().from(commodity).where(eq(commodity.slug, 'castor'));
    const [gondal] = await t.db.select().from(market).where(eq(market.slug, 'gondal'));
    const [per20] = await t.db.select().from(unit).where(eq(unit.code, 'per_20kg'));
    await t.db.insert(priceObservation).values({
      messageId,
      commodityId: castor!.id,
      marketId: gondal!.id,
      unitId: per20!.id,
      obsDate: '2026-10-20',
      minRaw: 1260,
      maxRaw: 1288,
      minPerQuintal: 6300,
      maxPerQuintal: 6440,
      confidence: 0.94,
      status,
    });
  };

  it('lists watched and active groups, latest activity first, with today counts', async () => {
    await addMessage(ids.gondal, 'old', new Date('2026-10-18T06:00:00Z'), 'old rate');
    const greeting = await addMessage(ids.gondal, 'a', minutesAgo(120), 'Good morning sabh ne');
    const rate = await addMessage(ids.gondal, 'b', minutesAgo(10), 'Gondal arenda close 1260-1288');
    await addObservation(rate);
    await addObservation(rate, 'rejected');
    await addMessage(ids.rajkot, 'c', minutesAgo(30), 'Sing G20 1050-1140');
    expect(greeting).toBeGreaterThan(0);

    const res = await t.request('/v1/chats', { device: false });
    expect(res.status).toBe(200);
    const chats = await res.json();
    expect(validatorFor('Chat')(chats[0])).toBe(true);

    expect(chats.map((c: { name: string }) => c.name)).toEqual([
      'Gondal Castor Rates',
      'Rajkot Groundnut Bazaar',
      'Unjha Mandi Updates',
    ]);
    expect(chats[0]).toMatchObject({
      jid: 'g1@g.us',
      member_count: 146,
      primary_commodities: ['castor'],
      today_count: 2,
      today_price_count: 1,
      last_message: { text: 'Gondal arenda close 1260-1288', sender_name: 'Ramesh Bhai', type: 'text' },
    });
    expect(chats[2]).toMatchObject({ last_message: null, today_count: 0, today_price_count: 0 });
  });

  it('lists an unwatched group once it has messages', async () => {
    await addMessage(ids.unwatched, 'f', minutesAgo(5), 'Hello');
    const chats = await (await t.request('/v1/chats', { device: false })).json();
    expect(chats[0].name).toBe('Family');
  });

  it('puts the extracted prices and media on each message in the feed', async () => {
    const rate = await addMessage(ids.gondal, 'b', minutesAgo(10), 'Gondal arenda close 1260-1288');
    await addObservation(rate);
    await addObservation(rate, 'rejected');
    const photo = await addMessage(ids.gondal, 'p', minutesAgo(5), null, 'image');
    await t.db.insert(waMedia).values({ messageId: photo, gcsPath: 'x', mime: 'image/jpeg', sizeBytes: 1, sha256: 'abc' });

    const page = await (await t.request('/v1/messages?group=g1@g.us', { device: false })).json();
    expect(validatorFor('MessagePage')(page)).toBe(true);
    const [photoItem, rateItem] = page.items;
    expect(photoItem.media).toEqual([{ id: expect.any(Number), mime: 'image/jpeg', url: null, ocr_status: 'pending' }]);
    expect(photoItem.observations).toEqual([]);
    expect(rateItem.observations).toHaveLength(1);
    expect(rateItem.observations[0]).toMatchObject({
      commodity: 'castor',
      market: 'gondal',
      unit: 'per_20kg',
      min_raw: 1260,
      max_per_quintal: 6440,
      status: 'auto',
    });
  });
});
