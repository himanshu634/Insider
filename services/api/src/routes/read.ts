/** Read side for the web app: brief, prices, spreads, insights and the message feed. */
import { aliasedTable, and, desc, eq, gte, ilike, inArray, lt, lte, max, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Schemas } from '../contract.js';
import {
  commodity,
  contentCluster,
  dailyBrief,
  dailyPrice,
  insight,
  market,
  messageLabel,
  priceObservation,
  waGroup,
  waMedia,
  waMessage,
} from '../db/schema.js';
import type { AppEnv } from '../env.js';
import { badRequest, dateParam, decodeCursor, intParam, limitParam, nextCursor, notFound } from '../http.js';
import { observationQuery, toObservation } from './review.js';

export const read = new Hono<AppEnv>();

// ---------------------------------------------------------------- insights + brief

const insightCommodity = aliasedTable(commodity, 'insight_commodity');
const insightMarket = aliasedTable(market, 'insight_market');

type InsightRow = {
  insight: typeof insight.$inferSelect;
  commodity: string | null;
  market: string | null;
};

const toInsight = (r: InsightRow): Schemas['Insight'] => ({
  id: r.insight.id,
  date: r.insight.date,
  type: r.insight.type,
  commodity: r.commodity,
  market: r.market,
  severity: r.insight.severity,
  title: r.insight.title,
  detail: r.insight.detail,
});

const insightSelect = (db: AppEnv['Variables']['db']) =>
  db
    .select({ insight, commodity: insightCommodity.slug, market: insightMarket.slug })
    .from(insight)
    .leftJoin(insightCommodity, eq(insight.commodityId, insightCommodity.id))
    .leftJoin(insightMarket, eq(insight.marketId, insightMarket.id));

read.get('/v1/insights', async (c) => {
  const q = c.req.query();
  const limit = limitParam(q.limit);
  const cursor = decodeCursor(q.cursor);
  const from = dateParam(q.from, 'from');
  const to = dateParam(q.to, 'to');
  const rows = await insightSelect(c.var.db)
    .where(
      and(
        q.type ? eq(insight.type, q.type as Schemas['InsightType']) : undefined,
        q.commodity ? eq(insightCommodity.slug, q.commodity) : undefined,
        q.severity ? eq(insight.severity, q.severity as Schemas['Severity']) : undefined,
        from ? gte(insight.date, from) : undefined,
        to ? lte(insight.date, to) : undefined,
        cursor !== undefined ? lt(insight.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(insight.id))
    .limit(limit);
  return c.json({
    items: rows.map(toInsight),
    next_cursor: nextCursor(
      rows.map((r) => r.insight.id),
      limit,
    ),
  } satisfies Schemas['InsightPage']);
});

read.get('/v1/brief/:date', async (c) => {
  const date = dateParam(c.req.param('date'), 'date')!;
  const [brief] = await c.var.db.select().from(dailyBrief).where(eq(dailyBrief.date, date));
  if (!brief) throw notFound('No brief for this date yet');
  const rows = await insightSelect(c.var.db).where(eq(insight.date, date));
  return c.json({
    date: brief.date,
    body: brief.body,
    generated_at: brief.generatedAt?.toISOString() ?? null,
    insights: rows.map(toInsight),
  } satisfies Schemas['Brief']);
});

// ---------------------------------------------------------------- prices

read.get('/v1/prices/latest', async (c) => {
  const { commodity: commoditySlug, district } = c.req.query();
  const { db } = c.var;
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
        commoditySlug ? eq(commodity.slug, commoditySlug) : undefined,
        district ? eq(market.district, district) : undefined,
      ),
    )
    .orderBy(commodity.slug, market.slug);
  // Change vs yesterday / 7-day average is computed by the aggregate job (Phase 4).
  return c.json(
    rows.map(
      (r): Schemas['LatestPrice'] => ({
        commodity: r.commodity,
        market: r.market,
        district: r.district,
        obs_date: r.dp.date,
        min_per_quintal: r.dp.min,
        max_per_quintal: r.dp.max,
        modal_per_quintal: r.dp.medianModal,
        change_vs_yesterday: null,
        change_vs_7d_avg: null,
        source_count: r.dp.sourceCount,
        group_count: r.dp.groupCount,
      }),
    ),
  );
});

read.get('/v1/prices/daily', async (c) => {
  const q = c.req.query();
  if (!q.commodity) throw badRequest('commodity is required');
  const from = dateParam(q.from, 'from');
  const to = dateParam(q.to, 'to');
  const markets = q.markets
    ?.split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const rows = await c.var.db
    .select({ dp: dailyPrice, commodity: commodity.slug, market: market.slug })
    .from(dailyPrice)
    .innerJoin(commodity, eq(dailyPrice.commodityId, commodity.id))
    .innerJoin(market, eq(dailyPrice.marketId, market.id))
    .where(
      and(
        eq(commodity.slug, q.commodity),
        markets?.length ? inArray(market.slug, markets) : undefined,
        from ? gte(dailyPrice.date, from) : undefined,
        to ? lte(dailyPrice.date, to) : undefined,
      ),
    )
    .orderBy(dailyPrice.date, market.slug);
  return c.json(
    rows.map(
      (r): Schemas['DailyPricePoint'] => ({
        commodity: r.commodity,
        market: r.market,
        date: r.dp.date,
        median_modal: r.dp.medianModal,
        min: r.dp.min,
        max: r.dp.max,
        arrivals_quintal: r.dp.arrivalsQuintal,
        source_count: r.dp.sourceCount,
        group_count: r.dp.groupCount,
        quality_flag: r.dp.qualityFlag,
      }),
    ),
  );
});

read.get('/v1/spreads', async (c) => {
  const q = c.req.query();
  if (!q.commodity) throw badRequest('commodity is required');
  const date = dateParam(q.date, 'date');
  if (!date) throw badRequest('date is required');
  const rows = await c.var.db
    .select({ market: market.slug, modal: dailyPrice.medianModal })
    .from(dailyPrice)
    .innerJoin(commodity, eq(dailyPrice.commodityId, commodity.id))
    .innerJoin(market, eq(dailyPrice.marketId, market.id))
    .where(and(eq(commodity.slug, q.commodity), eq(dailyPrice.date, date)))
    .orderBy(desc(dailyPrice.medianModal));
  if (rows.length === 0) throw notFound('No prices for this commodity and date');
  const base = q.base_market ?? rows.at(-1)!.market; // default base: the cheapest market
  const basePrice = rows.find((r) => r.market === base)?.modal;
  if (basePrice === undefined) throw notFound('Base market has no price on this date');
  return c.json({
    commodity: q.commodity,
    date,
    base_market: base,
    rows: rows.map((r) => ({
      market: r.market,
      modal_per_quintal: r.modal,
      diff_vs_base: r.modal - basePrice,
    })),
  } satisfies Schemas['Spread']);
});

// ---------------------------------------------------------------- messages

const latestLabel = sql<Schemas['MessageLabelValue'] | null>`(
  select ${messageLabel.label} from ${messageLabel}
  where ${messageLabel.messageId} = ${waMessage.id}
  order by ${messageLabel.id} desc limit 1
)`;

const messageSelect = (db: AppEnv['Variables']['db']) =>
  db
    .select({
      message: waMessage,
      groupJid: waGroup.jid,
      groupName: waGroup.name,
      label: latestLabel,
      clusterGroupCount: sql<number>`coalesce(${contentCluster.groupCount}, 1)`,
    })
    .from(waMessage)
    .innerJoin(waGroup, eq(waMessage.groupId, waGroup.id))
    .leftJoin(contentCluster, eq(waMessage.clusterId, contentCluster.id));

type MessageRow = Awaited<ReturnType<ReturnType<typeof messageSelect>['execute']>>[number];

const toMessage = (r: MessageRow): Schemas['Message'] => ({
  id: r.message.id,
  group: { jid: r.groupJid, name: r.groupName },
  sender_name: r.message.senderName,
  sent_at: r.message.sentAt.toISOString(),
  type: r.message.type,
  text: r.message.text,
  label: r.label,
  is_forwarded: r.message.isForwarded,
  cluster_group_count: Number(r.clusterGroupCount),
});

/** Start of an IST calendar day, as an instant. */
const istDayStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

read.get('/v1/messages', async (c) => {
  const q = c.req.query();
  const limit = limitParam(q.limit);
  const cursor = decodeCursor(q.cursor);
  const from = dateParam(q.from, 'from');
  const to = dateParam(q.to, 'to');
  const rows = await messageSelect(c.var.db)
    .where(
      and(
        q.group ? eq(waGroup.jid, q.group) : undefined,
        q.label ? sql`${latestLabel} = ${q.label}` : undefined,
        // Phase 1: substring match. Postgres full-text (tsvector + GIN) comes with the feed work.
        q.q ? ilike(waMessage.text, `%${q.q}%`) : undefined,
        from ? gte(waMessage.sentAt, istDayStart(from)) : undefined,
        to
          ? lt(waMessage.sentAt, new Date(istDayStart(to).getTime() + 24 * 3600 * 1000))
          : undefined,
        cursor !== undefined ? lt(waMessage.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(waMessage.id))
    .limit(limit);
  return c.json({
    items: rows.map(toMessage),
    next_cursor: nextCursor(
      rows.map((r) => r.message.id),
      limit,
    ),
  } satisfies Schemas['MessagePage']);
});

read.get('/v1/messages/:id', async (c) => {
  const id = intParam(c.req.param('id'));
  const { db } = c.var;
  const [row] = await messageSelect(db).where(eq(waMessage.id, id));
  if (!row) throw notFound('Unknown message');
  const observations = await observationQuery(db).where(eq(priceObservation.messageId, id));
  const media = await db.select().from(waMedia).where(eq(waMedia.messageId, id));
  return c.json({
    ...toMessage(row),
    observations: observations.map(toObservation),
    // Signed read URLs come with the media viewer (Phase 2).
    media: media.map((m) => ({ id: m.id, mime: m.mime, url: null, ocr_status: m.ocrStatus })),
  } satisfies Schemas['MessageDetail']);
});
