/** Review queue: low-confidence extractions approved, edited or rejected by the team. */
import { and, desc, eq, lt } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Schemas } from '../contract.js';
import type { Db } from '../db/client.js';
import { commodity, extractionEvent, market, priceObservation, unit } from '../db/schema.js';
import type { AppEnv } from '../env.js';
import { badRequest, body, decodeCursor, limitParam, nextCursor, notFound } from '../http.js';

export const review = new Hono<AppEnv>();

export const observationQuery = (db: Db) =>
  db
    .select({
      obs: priceObservation,
      commodity: commodity.slug,
      market: market.slug,
      unit: unit.code,
    })
    .from(priceObservation)
    .innerJoin(commodity, eq(priceObservation.commodityId, commodity.id))
    .innerJoin(market, eq(priceObservation.marketId, market.id))
    .innerJoin(unit, eq(priceObservation.unitId, unit.id));

type ObservationRow = Awaited<ReturnType<ReturnType<typeof observationQuery>['execute']>>[number];

export const toObservation = ({ obs, ...names }: ObservationRow): Schemas['PriceObservation'] => ({
  id: obs.id,
  message_id: obs.messageId,
  commodity: names.commodity,
  variety: obs.variety,
  market: names.market,
  obs_date: obs.obsDate,
  min_raw: obs.minRaw,
  max_raw: obs.maxRaw,
  modal_raw: obs.modalRaw,
  unit: names.unit,
  min_per_quintal: obs.minPerQuintal,
  max_per_quintal: obs.maxPerQuintal,
  modal_per_quintal: obs.modalPerQuintal,
  arrivals_quintal: obs.arrivalsQuintal,
  confidence: obs.confidence,
  status: obs.status,
});

const snapshot = (o: typeof priceObservation.$inferSelect) => ({
  commodity_id: o.commodityId,
  market_id: o.marketId,
  unit_id: o.unitId,
  variety: o.variety,
  obs_date: o.obsDate,
  min_raw: o.minRaw,
  max_raw: o.maxRaw,
  modal_raw: o.modalRaw,
  arrivals_quintal: o.arrivalsQuintal,
});

review.get('/v1/review/observations', async (c) => {
  const q = c.req.query();
  const limit = limitParam(q.limit);
  const cursor = decodeCursor(q.cursor);
  const status = (q.status ?? 'needs_review') as Schemas['ObservationStatus'];
  const rows = await observationQuery(c.var.db)
    .where(
      and(
        eq(priceObservation.status, status),
        cursor !== undefined ? lt(priceObservation.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(priceObservation.id))
    .limit(limit);
  return c.json({
    items: rows.map(toObservation),
    next_cursor: nextCursor(
      rows.map((r) => r.obs.id),
      limit,
    ),
  } satisfies Schemas['ObservationPage']);
});

async function lookupId(db: Db, table: typeof commodity | typeof market, slug: string) {
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.slug, slug));
  if (!row) throw badRequest(`Unknown ${slug}`);
  return row.id;
}

review.patch('/v1/review/observations', body('ObservationReview'), async (c) => {
  const req = c.req.valid('json');
  const { db, user } = c.var;
  const updated = await db.transaction(async (tx) => {
    const [obs] = await tx.select().from(priceObservation).where(eq(priceObservation.id, req.id));
    if (!obs) throw notFound('Unknown observation');
    const before = snapshot(obs);

    let action: 'approved' | 'rejected' | 'edited';
    let changes: Partial<typeof priceObservation.$inferInsert> = {};
    if (req.action === 'approve') {
      action = 'approved';
      changes = { status: 'approved' };
    } else if (req.action === 'reject') {
      action = 'rejected';
      changes = { status: 'rejected' };
    } else {
      action = 'edited';
      const e = req.changes ?? {};
      changes = {
        status: 'approved',
        ...(e.commodity !== undefined && { commodityId: await lookupId(tx, commodity, e.commodity) }),
        ...(e.market !== undefined && { marketId: await lookupId(tx, market, e.market) }),
        ...(e.variety !== undefined && { variety: e.variety }),
        ...(e.obs_date !== undefined && { obsDate: e.obs_date }),
        ...(e.min_raw !== undefined && { minRaw: e.min_raw }),
        ...(e.max_raw !== undefined && { maxRaw: e.max_raw }),
        ...(e.modal_raw !== undefined && { modalRaw: e.modal_raw }),
        ...(e.arrivals_quintal !== undefined && { arrivalsQuintal: e.arrivals_quintal }),
      };
      if (e.unit !== undefined) {
        const [u] = await tx.select({ id: unit.id }).from(unit).where(eq(unit.code, e.unit));
        if (!u) throw badRequest(`Unknown unit ${e.unit}`);
        changes.unitId = u.id;
      }
      // Per-quintal values are recomputed by the normalize step once edits land (Phase 3).
    }
    const [after] = await tx
      .update(priceObservation)
      .set(changes)
      .where(eq(priceObservation.id, obs.id))
      .returning();
    await tx.insert(extractionEvent).values({
      observationId: obs.id,
      action,
      actor: `user:${user.id}`,
      before,
      after: snapshot(after!),
    });
    return after!;
  });
  const [row] = await observationQuery(db).where(eq(priceObservation.id, updated.id));
  return c.json(toObservation(row!));
});
