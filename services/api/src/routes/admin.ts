/** Settings: groups, collector health and the dictionaries. */
import { asc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';

import type { Schemas } from '../contract.js';
import { collectorDevice, commodity, market, unit, waGroup } from '../db/schema.js';
import type { AppEnv } from '../env.js';
import { body, intParam, notFound } from '../http.js';

export const admin = new Hono<AppEnv>();

const toGroup = (g: typeof waGroup.$inferSelect): Schemas['Group'] => ({
  id: g.id,
  jid: g.jid,
  name: g.name,
  member_count: g.memberCount,
  is_watched: g.isWatched,
  region_tag: g.regionTag,
  primary_commodities: g.primaryCommodities,
  last_message_at: g.lastMessageAt?.toISOString() ?? null,
});

admin.get('/v1/groups', async (c) => {
  const groups = await c.var.db.select().from(waGroup).orderBy(asc(waGroup.name));
  return c.json(groups.map(toGroup));
});

admin.patch('/v1/groups', body('GroupUpdate'), async (c) => {
  const req = c.req.valid('json');
  const [group] = await c.var.db
    .update(waGroup)
    .set({
      ...(req.is_watched !== undefined && { isWatched: req.is_watched }),
      ...(req.region_tag !== undefined && { regionTag: req.region_tag }),
      ...(req.primary_commodities !== undefined && { primaryCommodities: req.primary_commodities }),
    })
    .where(eq(waGroup.id, req.id))
    .returning();
  if (!group) throw notFound('Unknown group');
  return c.json(toGroup(group));
});

admin.get('/v1/devices', async (c) => {
  const devices = await c.var.db.select().from(collectorDevice).orderBy(asc(collectorDevice.id));
  return c.json(
    devices.map(
      (d): Schemas['Device'] => ({
        id: d.id,
        name: d.name,
        app_version: d.appVersion,
        schema_fingerprint: d.schemaFingerprint,
        last_heartbeat_at: d.lastHeartbeatAt?.toISOString() ?? null,
        last_sync_at: d.lastSyncAt?.toISOString() ?? null,
        outbox_size: d.outboxSize,
        status: d.status,
      }),
    ),
  );
});

// ---------------------------------------------------------------- dictionaries

const toCommodity = (r: typeof commodity.$inferSelect): Schemas['Commodity'] => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  varieties: r.varieties,
  synonyms: r.synonyms,
});
const fromCommodity = (b: Schemas['CommodityInput']) => ({
  slug: b.slug,
  name: b.name,
  varieties: b.varieties ?? [],
  synonyms: b.synonyms ?? [],
});

const toMarket = (r: typeof market.$inferSelect): Schemas['Market'] => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  district: r.district,
  state: r.state,
  aliases: r.aliases,
  lat: r.lat,
  lng: r.lng,
});
const fromMarket = (b: Schemas['MarketInput']) => ({
  slug: b.slug,
  name: b.name,
  district: b.district ?? null,
  state: b.state,
  aliases: b.aliases ?? [],
  lat: b.lat ?? null,
  lng: b.lng ?? null,
});

const toUnit = (r: typeof unit.$inferSelect): Schemas['Unit'] => ({
  id: r.id,
  code: r.code,
  label: r.label,
  factor_to_quintal: r.factorToQuintal,
  aliases: r.aliases,
});
const fromUnit = (b: Schemas['UnitInput']) => ({
  code: b.code,
  label: b.label,
  factorToQuintal: b.factor_to_quintal,
  aliases: b.aliases ?? [],
});

const isUniqueViolation = (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } })?.code === '23505' ||
  (e as { cause?: { code?: string } })?.cause?.code === '23505';
const isFkViolation = (e: unknown) =>
  (e as { code?: string })?.code === '23503' ||
  (e as { cause?: { code?: string } })?.cause?.code === '23503';

/** CRUD for one dictionary table. Kept generic: the three tables differ only in mapping. */
function dictionary<T extends typeof commodity | typeof market | typeof unit>(
  path: string,
  table: T,
  schemaName: 'CommodityInput' | 'MarketInput' | 'UnitInput',
  to: (row: T['$inferSelect']) => unknown,
  from: (b: never) => T['$inferInsert'],
) {
  admin.get(path, async (c) => {
    const rows = await c.var.db.select().from(table as typeof commodity).orderBy(asc(table.id));
    return c.json(rows.map((r) => to(r as T['$inferSelect'])));
  });

  admin.post(path, body(schemaName), async (c: Context<AppEnv>) => {
    try {
      const [row] = await c.var.db
        .insert(table as typeof commodity)
        .values(from(c.req.valid('json' as never) as never) as never)
        .returning();
      return c.json(to(row as T['$inferSelect']), 201);
    } catch (e) {
      if (isUniqueViolation(e)) return c.json({ detail: 'Already exists' }, 409);
      throw e;
    }
  });

  admin.put(`${path}/:id`, body(schemaName), async (c: Context<AppEnv>) => {
    const [row] = await c.var.db
      .update(table as typeof commodity)
      .set(from(c.req.valid('json' as never) as never) as never)
      .where(eq(table.id, intParam(c.req.param('id'))))
      .returning();
    if (!row) throw notFound();
    return c.json(to(row as T['$inferSelect']));
  });

  admin.delete(`${path}/:id`, async (c) => {
    try {
      const [row] = await c.var.db
        .delete(table as typeof commodity)
        .where(eq(table.id, intParam(c.req.param('id'))))
        .returning({ id: table.id });
      if (!row) throw notFound();
      return c.body(null, 204);
    } catch (e) {
      if (isFkViolation(e)) return c.json({ detail: 'Still referenced by prices' }, 409);
      throw e;
    }
  });
}

dictionary('/v1/dictionaries/commodities', commodity, 'CommodityInput', toCommodity, fromCommodity as never);
dictionary('/v1/dictionaries/markets', market, 'MarketInput', toMarket, fromMarket as never);
dictionary('/v1/dictionaries/units', unit, 'UnitInput', toUnit, fromUnit as never);
