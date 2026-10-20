import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { commodity, dailyPrice, market } from '../src/db/schema.js';
import { setup } from './helpers.js';

describe('GET /v1/prices/latest', () => {
  let t: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    t = await setup();
    const [castor] = await t.db.select().from(commodity).where(eq(commodity.slug, 'castor'));
    const [gondal] = await t.db.select().from(market).where(eq(market.slug, 'gondal'));
    const base = { commodityId: castor!.id, marketId: gondal!.id, qualityFlag: 'ok' as const };
    await t.db.insert(dailyPrice).values([
      { ...base, date: '2026-10-18', medianModal: 6200, min: 6150, max: 6250, sourceCount: 2, groupCount: 2 },
      { ...base, date: '2026-10-19', medianModal: 6300, min: 6260, max: 6340, sourceCount: 3, groupCount: 2 },
    ]);
  });

  afterEach(() => t.close());

  it('returns the newest row per commodity and market, without change figures yet', async () => {
    const res = await t.request('/v1/prices/latest?commodity=castor', { device: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({
        commodity: 'castor',
        market: 'gondal',
        district: 'Rajkot',
        obs_date: '2026-10-19',
        min_per_quintal: 6260,
        max_per_quintal: 6340,
        modal_per_quintal: 6300,
        change_vs_yesterday: null,
        change_vs_7d_avg: null,
        source_count: 3,
        group_count: 2,
      }),
    ]);
  });

  it('filters by district', async () => {
    const match = await t.request('/v1/prices/latest?district=Rajkot', { device: false });
    expect(await match.json()).toHaveLength(1);
    const none = await t.request('/v1/prices/latest?district=Unjha', { device: false });
    expect(await none.json()).toEqual([]);
  });
});
