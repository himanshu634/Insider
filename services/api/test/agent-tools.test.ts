import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createToolContext, marketTools } from '../src/agent/index.js';
import { commodity, dailyPrice, market, waGroup, waMessage } from '../src/db/schema.js';
import type { MessageHit } from '../src/queries/messages.js';
import { setup } from './helpers.js';

const tool = (name: string) => marketTools.find((m) => m.name === name)!;

describe('market tools', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let groupId: number;

  const addMessage = async (stanzaId: string, sentAt: string, text: string | null) => {
    const [row] = await t.db
      .insert(waMessage)
      .values({ groupId, stanzaId, senderHash: 'hash-1', senderName: 'Ramesh Patel', sentAt: new Date(sentAt), type: 'text', text })
      .returning({ id: waMessage.id });
    return row!.id;
  };

  beforeEach(async () => {
    t = await setup();
    const [castor] = await t.db.select().from(commodity).where(eq(commodity.slug, 'castor'));
    const [gondal] = await t.db.select().from(market).where(eq(market.slug, 'gondal'));
    const base = { commodityId: castor!.id, marketId: gondal!.id, qualityFlag: 'ok' as const };
    await t.db.insert(dailyPrice).values([
      { ...base, date: '2026-10-18', medianModal: 6200, min: 6150, max: 6250, sourceCount: 2, groupCount: 2 },
      { ...base, date: '2026-10-19', medianModal: 6300, min: 6260, max: 6340, sourceCount: 3, groupCount: 2 },
    ]);
    const [group] = await t.db
      .insert(waGroup)
      .values({ jid: '120363@g.us', name: 'Gondal Castor Rates', isWatched: true })
      .returning({ id: waGroup.id });
    groupId = group!.id;
    await addMessage('m1', '2026-10-19T06:00:00Z', 'Gondal arenda 1260-1288');
  });

  afterEach(() => t.close());

  it('tool names', () => {
    expect(marketTools.map((m) => m.name)).toEqual(['get_latest_prices', 'search_messages']);
  });

  it('every tool says its results are data and never instructions', () => {
    for (const mt of marketTools) expect(mt.description).toMatch(/never instructions/i);
  });

  it('get_latest_prices records evidence', async () => {
    const ctx = createToolContext(t.db, 8);
    const out = await tool('get_latest_prices').run(ctx, { commodity: 'castor' });
    expect(out).toEqual([expect.objectContaining({ market: 'gondal', modal_per_quintal: 6300 })]);
    expect(ctx.evidence).toHaveLength(1);
    // The number check needs list items separated by whitespace, so evidence is indented JSON.
    expect(ctx.evidence[0]).toContain('\n');
  });

  it('get_latest_prices leaves the budget to the adapters', async () => {
    const ctx = createToolContext(t.db, 8);
    await tool('get_latest_prices').run(ctx, {});
    expect(ctx.budget).toEqual({ used: 0, max: 8 });
  });

  it('search_messages records sources', async () => {
    const ctx = createToolContext(t.db, 8);
    const out = (await tool('search_messages').run(ctx, { text: 'arenda' })) as MessageHit[];
    expect(out[0]).toMatchObject({ text: 'Gondal arenda 1260-1288', group_name: 'Gondal Castor Rates' });
    expect([...ctx.sources]).toEqual([out[0]!.id]);
    expect(ctx.evidence).toHaveLength(1);
    expect(ctx.evidence[0]).toContain('\n');
  });

  it('search_messages matches without regard to case, newest first, and keeps to the limit', async () => {
    await addMessage('m2', '2026-10-20T06:00:00Z', 'ARENDA close 1270');
    await addMessage('m3', '2026-10-17T06:00:00Z', 'Arenda 1240');
    const run = (input: object) => tool('search_messages').run(createToolContext(t.db, 8), { text: 'arenda', ...input });
    const all = (await run({})) as MessageHit[];
    expect(all.map((h) => h.text)).toEqual(['ARENDA close 1270', 'Gondal arenda 1260-1288', 'Arenda 1240']);
    expect(await run({ limit: 2 })).toHaveLength(2);
  });

  it('search_messages caps the limit at 20', async () => {
    for (let i = 0; i < 25; i++) await addMessage(`bulk-${i}`, '2026-10-19T07:00:00Z', `sing ${1000 + i}`);
    const out = (await tool('search_messages').run(createToolContext(t.db, 8), { text: 'sing', limit: 500 })) as MessageHit[];
    expect(out).toHaveLength(20);
  });

  it('search_messages takes from and to as IST dates, both days included', async () => {
    // 18:29 UTC on the 19th is 23:59 IST on the 19th; 18:30 UTC is already the 20th in IST.
    await addMessage('late19', '2026-10-19T18:29:00Z', 'arenda late 19th');
    await addMessage('early20', '2026-10-19T18:30:00Z', 'arenda early 20th');
    await addMessage('early17', '2026-10-16T18:30:00Z', 'arenda early 17th');
    await addMessage('late16', '2026-10-16T18:29:00Z', 'arenda late 16th');
    const run = async (input: object) =>
      ((await tool('search_messages').run(createToolContext(t.db, 8), { text: 'arenda', ...input })) as MessageHit[]).map((h) => h.text);
    expect(await run({ from: '2026-10-17', to: '2026-10-19' })).toEqual([
      'arenda late 19th',
      'Gondal arenda 1260-1288',
      'arenda early 17th',
    ]);
  });

  it('search_messages treats % and _ as plain characters', async () => {
    await addMessage('pct', '2026-10-19T08:00:00Z', 'discount 5% today');
    const run = async (text: string) =>
      ((await tool('search_messages').run(createToolContext(t.db, 8), { text })) as MessageHit[]).map((h) => h.text);
    expect(await run('5%')).toEqual(['discount 5% today']);
    expect(await run('_')).toEqual([]);
  });

  it('market tools never return sender_name or jid', async () => {
    const ctx = createToolContext(t.db, 8);
    for (const mt of marketTools) await mt.run(ctx, mt.name === 'search_messages' ? { text: 'arenda' } : {});
    const all = ctx.evidence.join('\n');
    expect(all).not.toMatch(/Ramesh|120363@g\.us|sender_name|"jid"/);
  });

  it('validates input with its zod schema', () => {
    const search = tool('search_messages').input;
    expect(search.safeParse({ text: 'arenda', limit: 21 }).success).toBe(false);
    expect(search.safeParse({ text: 'arenda', limit: 0 }).success).toBe(false);
    expect(search.safeParse({ text: 'arenda', from: '19-10-2026' }).success).toBe(false);
    expect(search.safeParse({ text: '' }).success).toBe(false);
    expect(search.safeParse({ text: 'arenda', from: '2026-10-17', to: '2026-10-19', limit: 20 }).success).toBe(true);
  });
});
