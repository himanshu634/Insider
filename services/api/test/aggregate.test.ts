import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  commodity,
  contentCluster,
  dailyPrice,
  dailyPriceDirty,
  insight,
  market,
  priceObservation,
  unit,
  waGroup,
  waMessage,
} from '../src/db/schema.js';
import { aggregateDirty, aggregateFullRebuild, clearMark, markDirty, rebuildCell } from '../src/pipeline/aggregate.js';
import { processMessage } from '../src/pipeline/tasks.js';
import { setup } from './helpers.js';
import { scriptedAnthropic, text } from './scripted-anthropic.js';

const DATE = '2026-10-19';
const SENT_AT = new Date('2026-10-19T04:00:00Z');

describe('daily price aggregation', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let ids: { castor: number; groundnut: number; gondal: number; rajkot: number; jamnagar: number; quintal: number };
  let groups: number[];
  let stanza = 0;

  beforeEach(async () => {
    t = await setup();
    const slug = async (table: typeof commodity | typeof market, s: string) =>
      (await t.db.select({ id: table.id }).from(table).where(eq(table.slug, s)))[0]!.id;
    const [quintal] = await t.db.select().from(unit).where(eq(unit.code, 'per_quintal'));
    ids = {
      castor: await slug(commodity, 'castor'),
      groundnut: await slug(commodity, 'groundnut'),
      gondal: await slug(market, 'gondal'),
      rajkot: await slug(market, 'rajkot'),
      jamnagar: await slug(market, 'jamnagar'),
      quintal: quintal!.id,
    };
    groups = (
      await t.db
        .insert(waGroup)
        .values([1, 2, 3].map((n) => ({ jid: `g${n}@g.us`, name: `Group ${n}`, isWatched: true })))
        .returning({ id: waGroup.id })
    ).map((g) => g.id);
  });
  afterEach(() => t.close());

  /** A message in `group`, optionally in a content cluster. */
  const message = async (group: number, clusterId: number | null = null) => {
    const [m] = await t.db
      .insert(waMessage)
      .values({ groupId: group, stanzaId: `S${++stanza}`, senderHash: 'h', sentAt: SENT_AT, type: 'text', text: 'x', clusterId })
      .returning({ id: waMessage.id });
    return m!.id;
  };

  /** One observation per quintal, and its cell marked as the pipeline would. */
  const observe = async (
    messageId: number,
    o: { commodityId?: number; marketId?: number; min?: number; max?: number; modal?: number; variety?: string; status?: 'auto' | 'approved' | 'needs_review' | 'rejected' },
  ) => {
    const cell = { commodityId: o.commodityId ?? ids.castor, marketId: o.marketId ?? ids.gondal, date: DATE };
    const [row] = await t.db
      .insert(priceObservation)
      .values({
        messageId,
        commodityId: cell.commodityId,
        marketId: cell.marketId,
        obsDate: DATE,
        unitId: ids.quintal,
        variety: o.variety ?? null,
        minRaw: o.min ?? null,
        maxRaw: o.max ?? null,
        modalRaw: o.modal ?? null,
        minPerQuintal: o.min ?? null,
        maxPerQuintal: o.max ?? null,
        modalPerQuintal: o.modal ?? null,
        confidence: 1,
        status: o.status ?? 'auto',
      })
      .returning();
    await markDirty(t.db, [cell]);
    return row!;
  };

  const daily = async (marketId = ids.gondal, commodityId = ids.castor) =>
    (
      await t.db
        .select()
        .from(dailyPrice)
        .where(sql`${dailyPrice.commodityId} = ${commodityId} and ${dailyPrice.marketId} = ${marketId}`)
    )[0];

  it('counts a forward across groups as one source in two groups (AG-01, AG-03)', async () => {
    const first = await message(groups[0]!);
    const [cluster] = await t.db
      .insert(contentCluster)
      .values({ contentHash: 'x', canonicalMessageId: first, groupCount: 2 })
      .returning();
    await t.db.update(waMessage).set({ clusterId: cluster!.id }).where(eq(waMessage.id, first));
    await message(groups[1]!, cluster!.id);
    await observe(first, { min: 6250, max: 6450 });

    expect(await aggregateDirty(t.db)).toBe(1);
    expect(await daily()).toMatchObject({
      date: DATE,
      medianModal: 6350,
      min: 6250,
      max: 6450,
      sourceCount: 1,
      groupCount: 2,
      qualityFlag: 'single_source',
    });
    expect(await t.db.select().from(dailyPriceDirty)).toHaveLength(0);
  });

  it('flags sources that disagree and writes one conflict insight, however often it runs (AG-02)', async () => {
    await observe(await message(groups[0]!), { marketId: ids.jamnagar, modal: 6180 });
    await observe(await message(groups[1]!), { marketId: ids.jamnagar, modal: 6420 });
    await aggregateDirty(t.db);
    await aggregateFullRebuild(t.db);

    expect(await daily(ids.jamnagar)).toMatchObject({ medianModal: 6300, sourceCount: 2, groupCount: 2, qualityFlag: 'conflicting' });
    const insights = await t.db.select().from(insight);
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({ type: 'conflict', date: DATE, marketId: ids.jamnagar, title: 'Castor prices disagree in Jamnagar' });
    expect(insights[0]!.detail).toContain('₹6,180–₹6,420');
  });

  it('does not flag two varieties of one commodity as a conflict', async () => {
    const g = { commodityId: ids.groundnut, marketId: ids.rajkot };
    await observe(await message(groups[0]!), { ...g, variety: 'G20', min: 5250, max: 5700 });
    await observe(await message(groups[1]!), { ...g, variety: '66', min: 5750, max: 6150 });
    await observe(await message(groups[2]!), { ...g, variety: 'g20', min: 5260, max: 5690 });
    await aggregateDirty(t.db);
    expect(await daily(ids.rajkot, ids.groundnut)).toMatchObject({ sourceCount: 3, qualityFlag: 'ok', min: 5250, max: 6150 });
    expect(await t.db.select().from(insight)).toHaveLength(0);
  });

  it('leaves out observations in review or rejected (AG-05)', async () => {
    await observe(await message(groups[0]!), { modal: 6300 });
    await observe(await message(groups[1]!), { modal: 12550, status: 'needs_review' });
    await observe(await message(groups[2]!), { modal: 9000, status: 'rejected' });
    await observe(await message(groups[2]!), { marketId: ids.rajkot, modal: 6300, status: 'needs_review' });
    await aggregateDirty(t.db);
    expect(await daily()).toMatchObject({ medianModal: 6300, sourceCount: 1 });
    expect(await daily(ids.rajkot)).toBeUndefined();
  });

  it('removes the day when review rejects its only source', async () => {
    const obs = await observe(await message(groups[0]!), { modal: 6300 });
    await aggregateDirty(t.db);
    expect(await daily()).toBeDefined();

    const res = await t.request('/v1/review/observations', { method: 'PATCH', device: false, json: { id: obs.id, action: 'reject' } });
    expect(res.status).toBe(200);
    await aggregateDirty(t.db);
    expect(await daily()).toBeUndefined();
  });

  it('rebuilds both cells when review moves an observation to another mandi', async () => {
    const obs = await observe(await message(groups[0]!), { min: 1290, max: 1250, status: 'needs_review' });
    const res = await t.request('/v1/review/observations', {
      method: 'PATCH',
      device: false,
      json: { id: obs.id, action: 'edit', changes: { market: 'rajkot' } },
    });
    expect(res.status).toBe(200);
    await aggregateDirty(t.db);
    expect(await daily()).toBeUndefined();
    // An approved range written max-first still gives the right low and high.
    expect(await daily(ids.rajkot)).toMatchObject({ min: 1250, max: 1290, medianModal: 1270 });
  });

  it('keeps a mark that moved after it was read', async () => {
    const cell = { commodityId: ids.castor, marketId: ids.gondal, date: DATE };
    await markDirty(t.db, [cell]);
    const [first] = await t.db.select().from(dailyPriceDirty);
    await markDirty(t.db, [cell]);
    await clearMark(t.db, first!);
    const [kept] = await t.db.select().from(dailyPriceDirty);
    expect(kept!.version).toBeGreaterThan(first!.version);
    await clearMark(t.db, kept!);
    expect(await t.db.select().from(dailyPriceDirty)).toHaveLength(0);
  });

  it('drops daily prices with no observation left in the nightly rebuild', async () => {
    await t.db.insert(dailyPrice).values({
      commodityId: ids.castor,
      marketId: ids.rajkot,
      date: DATE,
      medianModal: 6000,
      sourceCount: 1,
      groupCount: 1,
      qualityFlag: 'single_source',
    });
    expect(await rebuildCell(t.db, { commodityId: ids.castor, marketId: ids.rajkot, date: DATE })).toBe(false);
    await t.db.insert(dailyPrice).values({
      commodityId: ids.castor,
      marketId: ids.rajkot,
      date: DATE,
      medianModal: 6000,
      sourceCount: 1,
      groupCount: 1,
      qualityFlag: 'single_source',
    });
    await aggregateFullRebuild(t.db);
    expect(await daily(ids.rajkot)).toBeUndefined();
  });

  it('serves an extracted price from /v1/prices/latest after the aggregate run', async () => {
    const body = 'singdana bold 1100-1180 per 20kg Rajkot';
    const [m] = await t.db
      .insert(waMessage)
      .values({ groupId: groups[0]!, stanzaId: 'E2E', senderHash: 'h', sentAt: SENT_AT, type: 'text', text: body })
      .returning({ id: waMessage.id });
    const { client } = scriptedAnthropic([
      {
        content: [
          text(
            JSON.stringify({
              label: 'price',
              rows: [
                {
                  kind: 'price',
                  commodity: 'groundnut',
                  commodity_term: 'singdana',
                  market: 'rajkot',
                  market_term: 'Rajkot',
                  variety: 'bold',
                  obs_date: null,
                  min_price: 1100,
                  max_price: 1180,
                  modal_price: null,
                  change: null,
                  unit_term: 'per 20kg',
                  arrivals: null,
                  arrivals_unit_term: null,
                  evidence: body,
                },
              ],
            }),
          ),
        ],
        stop_reason: 'end_turn',
      },
    ]);
    await processMessage({ db: t.db, anthropic: client, config: t.config }, { messageId: m!.id });
    expect(await aggregateDirty(t.db)).toBe(1);

    const latest = await (await t.request('/v1/prices/latest?commodity=groundnut', { device: false })).json();
    expect(latest.items ?? latest).toEqual([
      expect.objectContaining({ market: 'rajkot', obs_date: DATE, modal_per_quintal: 5700, min_per_quintal: 5500, max_per_quintal: 5900 }),
    ]);
  });
});
