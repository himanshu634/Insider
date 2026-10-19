/**
 * Per-message chain (dedupe → classify → extract → normalize → validate → store) and the
 * scheduled jobs. Phase 1: signatures and wiring; the logic lands in Phases 3–4.
 */
import { and, eq, lt, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { collectorDevice, contentCluster, waMessage } from '../db/schema.js';

export const WATCHDOG_SILENCE_MS = 30 * 60 * 1000;

/** Join the message to its content cluster. Returns false when it is a repeat (stop here). */
export async function dedupe(db: Db, messageId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [message] = await tx.select().from(waMessage).where(eq(waMessage.id, messageId));
    if (!message) return false;
    if (!message.contentHash) return true;

    const [created] = await tx
      .insert(contentCluster)
      .values({ contentHash: message.contentHash, canonicalMessageId: message.id })
      .onConflictDoNothing({ target: contentCluster.contentHash })
      .returning({ id: contentCluster.id });
    if (created) {
      await tx.update(waMessage).set({ clusterId: created.id }).where(eq(waMessage.id, message.id));
      return true;
    }
    const [cluster] = await tx
      .update(contentCluster)
      .set({ groupCount: sql`${contentCluster.groupCount} + 1` })
      .where(eq(contentCluster.contentHash, message.contentHash))
      .returning({ id: contentCluster.id });
    await tx.update(waMessage).set({ clusterId: cluster!.id }).where(eq(waMessage.id, message.id));
    return false;
  });
}

/** Rules first (no digits and no commodity keyword → noise), then a small model. */
export async function classify(_db: Db, _messageId: number): Promise<boolean> {
  return true;
}

/** Structured extraction with the per-commodity schema (see extraction/registry.ts). */
export async function extract(_db: Db, _messageId: number): Promise<boolean> {
  return true;
}

/** Canonical commodity, market match, unit → ₹/quintal. */
export async function normalize(_db: Db, _messageId: number): Promise<boolean> {
  return true;
}

/** Sanity bounds; confidence under 0.8 → needs_review. */
export async function validate(_db: Db, _messageId: number): Promise<boolean> {
  return true;
}

/** Write price_observation + extraction_event; mark commodity × market × date dirty. */
export async function store(_db: Db, _messageId: number): Promise<boolean> {
  return true;
}

export async function processMessage(db: Db, { messageId }: { messageId: number }) {
  for (const step of [dedupe, classify, extract, normalize, validate, store]) {
    if (!(await step(db, messageId))) return;
  }
}

/** Vision extraction for rate-sheet images and PDFs. */
export async function ocrMedia(_db: Db, _data: { mediaId: number }) {}

export async function aggregateDirty(_db: Db) {}
export async function aggregateFullRebuild(_db: Db) {}
export async function generateInsights(_db: Db) {}
export async function generateDailyBrief(_db: Db) {}
export async function proposeDictionaryAliases(_db: Db) {}

/** Mark devices silent after 30 minutes without a heartbeat. Returns the ids marked. */
export async function collectorWatchdog(db: Db, now = new Date()): Promise<number[]> {
  const cutoff = new Date(now.getTime() - WATCHDOG_SILENCE_MS);
  const silent = await db
    .update(collectorDevice)
    .set({ status: 'silent' })
    .where(and(eq(collectorDevice.status, 'active'), lt(collectorDevice.lastHeartbeatAt, cutoff)))
    .returning({ id: collectorDevice.id, name: collectorDevice.name });
  for (const d of silent) console.warn(`Collector ${d.id} (${d.name}) is silent`);
  return silent.map((d) => d.id);
}

export const handlers = {
  'process-message': processMessage,
  'ocr-media': ocrMedia,
  'aggregate-dirty': aggregateDirty,
  'aggregate-full-rebuild': aggregateFullRebuild,
  'generate-insights': generateInsights,
  'generate-daily-brief': generateDailyBrief,
  'collector-watchdog': collectorWatchdog,
  'propose-dictionary-aliases': proposeDictionaryAliases,
} as const;

export type JobName = keyof typeof handlers;
export type JobData<N extends JobName> = Parameters<(typeof handlers)[N]>[1];
