/** Price reads shared by the HTTP routes and the agent tools. No Hono here. */
import { and, eq, max } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { commodity, dailyPrice, market } from '../db/schema.js';

export interface LatestPriceRow {
  commodity: string;
  market: string;
  district: string | null;
  obs_date: string;
  min_per_quintal: number | null;
  max_per_quintal: number | null;
  modal_per_quintal: number;
  source_count: number;
  group_count: number;
}

/** The newest daily price of each commodity and market, optionally for one commodity or district. */
export async function latestPrices(
  db: Db,
  filter: { commodity?: string; district?: string },
): Promise<LatestPriceRow[]> {
  const latest = db
    .select({
      commodityId: dailyPrice.commodityId,
      marketId: dailyPrice.marketId,
      date: max(dailyPrice.date).as('latest_date'),
    })
    .from(dailyPrice)
    .groupBy(dailyPrice.commodityId, dailyPrice.marketId)
    .as('latest');
  const rows = await db
    .select({ dp: dailyPrice, commodity: commodity.slug, market: market.slug, district: market.district })
    .from(dailyPrice)
    .innerJoin(
      latest,
      and(
        eq(dailyPrice.commodityId, latest.commodityId),
        eq(dailyPrice.marketId, latest.marketId),
        eq(dailyPrice.date, latest.date),
      ),
    )
    .innerJoin(commodity, eq(dailyPrice.commodityId, commodity.id))
    .innerJoin(market, eq(dailyPrice.marketId, market.id))
    .where(
      and(
        filter.commodity ? eq(commodity.slug, filter.commodity) : undefined,
        filter.district ? eq(market.district, filter.district) : undefined,
      ),
    )
    .orderBy(commodity.slug, market.slug);
  return rows.map((r) => ({
    commodity: r.commodity,
    market: r.market,
    district: r.district,
    obs_date: r.dp.date,
    min_per_quintal: r.dp.min,
    max_per_quintal: r.dp.max,
    modal_per_quintal: r.dp.medianModal,
    source_count: r.dp.sourceCount,
    group_count: r.dp.groupCount,
  }));
}
