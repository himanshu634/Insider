/**
 * Rebuild `daily_price` (one row per commodity × market × date) from trusted observations: status auto or
 * approved, never needs_review or rejected (AG-05). A forward of one post across groups is one source with
 * several groups (AG-01). Sources of the same variety that disagree flag the cell `conflicting` and write one
 * `conflict` insight (AG-02); a single source flags it `single_source` (AG-03).
 *
 * `daily_price` has no variety column, so `median_modal` still mixes varieties of one commodity.
 */
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import {
  commodity,
  dailyPrice,
  dailyPriceDirty,
  insight,
  market,
  priceObservation,
  waMessage,
} from '../db/schema.js';
import { termKey } from '../extraction/dictionary.js';

/** Sources of one variety further apart than this share of their median disagree. */
export const CONFLICT_SPREAD = 0.03;
/** Cells rebuilt per read of the dirty marks. */
const DIRTY_BATCH = 200;
const TRUSTED = ['auto', 'approved'] as const;

export interface Cell {
  commodityId: number;
  marketId: number;
  date: string;
}

/** Mark cells for the next aggregate run. A cell already marked gets a later mark. */
export async function markDirty(db: Db, cells: readonly Cell[]): Promise<void> {
  const unique = [...new Map(cells.map((c) => [`${c.commodityId}:${c.marketId}:${c.date}`, c])).values()];
  if (!unique.length) return;
  await db
    .insert(dailyPriceDirty)
    .values(unique)
    .onConflictDoUpdate({
      target: [dailyPriceDirty.commodityId, dailyPriceDirty.marketId, dailyPriceDirty.date],
      set: { version: sql`nextval('market_intel.daily_price_dirty_version_seq')`, markedAt: sql`now()` },
    });
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const central = (o: { min: number | null; max: number | null; modal: number | null }) => {
  if (o.modal !== null) return o.modal;
  const ends = [o.min, o.max].filter((v): v is number => v !== null);
  return ends.length ? ends.reduce((a, b) => a + b, 0) / ends.length : null;
};

const rupees = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

/**
 * Rebuild one cell, in one transaction, under a lock on the cell: the 15-minute run and the nightly rebuild
 * may reach the same cell at once. Returns false when the cell has no trusted price (its row is removed).
 */
export async function rebuildCell(db: Db, cell: Cell): Promise<boolean> {
  return db.transaction(async (tx) => {
    const lockKey = `daily_price:${cell.commodityId}:${cell.marketId}:${cell.date}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const rows = await tx
      .select({
        messageId: priceObservation.messageId,
        clusterId: waMessage.clusterId,
        groupId: waMessage.groupId,
        variety: priceObservation.variety,
        min: priceObservation.minPerQuintal,
        max: priceObservation.maxPerQuintal,
        modal: priceObservation.modalPerQuintal,
        arrivals: priceObservation.arrivalsQuintal,
      })
      .from(priceObservation)
      .innerJoin(waMessage, eq(priceObservation.messageId, waMessage.id))
      .where(
        and(
          eq(priceObservation.commodityId, cell.commodityId),
          eq(priceObservation.marketId, cell.marketId),
          eq(priceObservation.obsDate, cell.date),
          inArray(priceObservation.status, TRUSTED),
        ),
      );
    const priced = rows.flatMap((r) => {
      const value = central(r);
      return value === null ? [] : [{ ...r, value, source: r.clusterId !== null ? `c${r.clusterId}` : `m${r.messageId}` }];
    });

    const cellWhere = and(
      eq(dailyPrice.commodityId, cell.commodityId),
      eq(dailyPrice.marketId, cell.marketId),
      eq(dailyPrice.date, cell.date),
    );
    const conflictWhere = and(
      eq(insight.type, 'conflict'),
      eq(insight.date, cell.date),
      eq(insight.commodityId, cell.commodityId),
      eq(insight.marketId, cell.marketId),
    );
    await tx.delete(insight).where(conflictWhere);
    if (!priced.length) {
      await tx.delete(dailyPrice).where(cellWhere);
      return false;
    }

    // One value per source (the median of its rows), then the median across sources.
    const bySource = groupBy(priced, (r) => r.source);
    const sourceValues = [...bySource.values()].map((rs) => median(rs.map((r) => r.value)));
    const ends = priced.flatMap((r) => [r.min, r.max, r.modal].filter((v): v is number => v !== null));
    const arrivals = priced.flatMap((r) => (r.arrivals === null ? [] : [r.arrivals]));

    // Groups: every group the contributing posts reached, forwards included.
    const clusterIds = [...new Set(priced.flatMap((r) => (r.clusterId === null ? [] : [r.clusterId])))];
    const unclustered = [...new Set(priced.flatMap((r) => (r.clusterId === null ? [r.messageId] : [])))];
    const groups = await tx
      .selectDistinct({ groupId: waMessage.groupId })
      .from(waMessage)
      .where(
        or(
          clusterIds.length ? inArray(waMessage.clusterId, clusterIds) : undefined,
          unclustered.length ? and(isNull(waMessage.clusterId), inArray(waMessage.id, unclustered)) : undefined,
        ),
      );

    // Conflicts are judged within one variety: varieties of one commodity differ by design.
    const disagreements: { variety: string; low: number; high: number }[] = [];
    for (const [variety, rs] of groupBy(priced, (r) => termKey(r.variety ?? ''))) {
      const values = [...groupBy(rs, (r) => r.source).values()].map((s) => median(s.map((r) => r.value)));
      if (values.length < 2) continue;
      const low = Math.min(...values);
      const high = Math.max(...values);
      if ((high - low) / median(values) > CONFLICT_SPREAD) disagreements.push({ variety, low, high });
    }

    const qualityFlag = disagreements.length ? 'conflicting' : sourceValues.length === 1 ? 'single_source' : 'ok';
    const values = {
      medianModal: median(sourceValues),
      min: Math.min(...ends),
      max: Math.max(...ends),
      arrivalsQuintal: arrivals.length ? median(arrivals) : null,
      sourceCount: sourceValues.length,
      groupCount: groups.length,
      qualityFlag,
      updatedAt: new Date(),
    } as const;
    await tx
      .insert(dailyPrice)
      .values({ ...cell, ...values })
      .onConflictDoUpdate({ target: [dailyPrice.commodityId, dailyPrice.marketId, dailyPrice.date], set: values });

    if (disagreements.length) {
      const [names] = await tx
        .select({ commodity: commodity.name, market: market.name })
        .from(commodity)
        .innerJoin(market, eq(market.id, cell.marketId))
        .where(eq(commodity.id, cell.commodityId));
      const detail = disagreements
        .map((d) => `${d.variety ? `${d.variety}: ` : ''}sources range ${rupees(d.low)}–${rupees(d.high)}/quintal`)
        .join('; ');
      await tx.insert(insight).values({
        date: cell.date,
        type: 'conflict',
        commodityId: cell.commodityId,
        marketId: cell.marketId,
        severity: 'notable',
        title: `${names!.commodity} prices disagree in ${names!.market}`,
        detail: `${detail}. The day's price is left out of forecasts until a person checks the reports.`,
      });
    }
    return true;
  });
}

/** Remove a mark only if it was not marked again since it was read. */
export async function clearMark(db: Db, mark: Cell & { version: number }): Promise<void> {
  await db
    .delete(dailyPriceDirty)
    .where(
      and(
        eq(dailyPriceDirty.commodityId, mark.commodityId),
        eq(dailyPriceDirty.marketId, mark.marketId),
        eq(dailyPriceDirty.date, mark.date),
        eq(dailyPriceDirty.version, mark.version),
      ),
    );
}

/** Rebuild every marked cell. A cell marked again while it was rebuilt stays marked for the next run. */
export async function aggregateDirty(db: Db): Promise<number> {
  let rebuilt = 0;
  for (;;) {
    const marks = await db.select().from(dailyPriceDirty).orderBy(asc(dailyPriceDirty.version)).limit(DIRTY_BATCH);
    if (!marks.length) return rebuilt;
    for (const mark of marks) {
      await rebuildCell(db, { commodityId: mark.commodityId, marketId: mark.marketId, date: mark.date });
      await clearMark(db, mark);
      rebuilt += 1;
    }
  }
}

/** Nightly: rebuild every cell that has an observation or a daily price, so orphan rows go too. */
export async function aggregateFullRebuild(db: Db): Promise<number> {
  const cells = await db
    .selectDistinct({
      commodityId: priceObservation.commodityId,
      marketId: priceObservation.marketId,
      date: priceObservation.obsDate,
    })
    .from(priceObservation)
    .union(
      db
        .select({ commodityId: dailyPrice.commodityId, marketId: dailyPrice.marketId, date: dailyPrice.date })
        .from(dailyPrice),
    );
  for (const cell of cells) await rebuildCell(db, cell);
  return cells.length;
}
