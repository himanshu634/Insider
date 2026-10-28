/**
 * Per-message chain (dedupe → classify → extract → normalize → validate → store) and the
 * scheduled jobs. Extraction reads text messages; vision, aggregation and insights land later.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, eq, gte, inArray, lt, notExists, sql } from 'drizzle-orm';

import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import {
  collectorDevice,
  contentCluster,
  extractionEvent,
  llmCall,
  messageLabel,
  priceObservation,
  waGroup,
  waMessage,
} from '../db/schema.js';
import { type Dictionary, loadDictionary } from '../extraction/dictionary.js';
import { callExtractor, type ExtractResult } from '../extraction/extract.js';
import { GATE_VERSION, gate } from '../extraction/gate.js';
import { type ExtractionOutput, packetText, systemPrompt, userPacket } from '../extraction/prompt.js';
import { centralPerQuintal, type NormalizedRow, normalizeRow, type RowContext } from '../extraction/rows.js';
import { SCHEDULE_TZ } from './schedule.js';

export const WATCHDOG_SILENCE_MS = 30 * 60 * 1000;

/** What every job handler gets. `anthropic` is null when ANTHROPIC_API_KEY is unset. */
export interface PipelineDeps {
  db: Db;
  anthropic: Anthropic | null;
  config: Config;
}

/**
 * Join the message to its content cluster. Returns false when it is a repeat (stop here).
 * Safe to run again on a retried job: a message already in a cluster is not counted twice.
 */
export async function dedupe(db: Db, messageId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [message] = await tx.select().from(waMessage).where(eq(waMessage.id, messageId));
    if (!message) return false;
    if (!message.contentHash) return true;
    if (message.clusterId !== null) {
      const [cluster] = await tx
        .select({ canonical: contentCluster.canonicalMessageId })
        .from(contentCluster)
        .where(eq(contentCluster.id, message.clusterId));
      return cluster?.canonical === message.id;
    }

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

const IST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The IST calendar date and time of an instant: { date: "2026-10-19", time: "09:20" }. */
export function istDateTime(at: Date) {
  const p = Object.fromEntries(IST_PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

interface LoadedMessage {
  message: typeof waMessage.$inferSelect;
  group: typeof waGroup.$inferSelect;
  quotedText: string | null;
}

async function loadMessage(db: Db, messageId: number): Promise<LoadedMessage | undefined> {
  const [row] = await db
    .select({ message: waMessage, group: waGroup })
    .from(waMessage)
    .innerJoin(waGroup, eq(waMessage.groupId, waGroup.id))
    .where(eq(waMessage.id, messageId));
  if (!row) return undefined;
  let quotedText: string | null = null;
  if (row.message.quotedStanzaId) {
    const [quoted] = await db
      .select({ text: waMessage.text })
      .from(waMessage)
      .where(and(eq(waMessage.groupId, row.message.groupId), eq(waMessage.stanzaId, row.message.quotedStanzaId)));
    quotedText = quoted?.text ?? null;
  }
  return { ...row, quotedText };
}

const isLabelled = async (db: Db, messageId: number) =>
  (await db.select({ id: messageLabel.id }).from(messageLabel).where(eq(messageLabel.messageId, messageId)).limit(1))
    .length > 0;

/**
 * Rules first: skip what is not text, label noise without a model call. Returns false when the chain stops here.
 * A message that already has a label was processed before, so a re-run stores nothing twice.
 */
export async function classify(db: Db, loaded: LoadedMessage, dict: Dictionary): Promise<boolean> {
  if (await isLabelled(db, loaded.message.id)) return false;
  const verdict = gate(loaded.message, dict);
  if (verdict === 'noise') {
    await db
      .insert(messageLabel)
      .values({ messageId: loaded.message.id, label: 'noise', confidence: 1, modelVersion: GATE_VERSION });
  }
  return verdict === 'candidate';
}

/** One structured-output call with the message packet (see extraction/). Logged in llm_call. */
export async function extract(
  deps: PipelineDeps & { anthropic: Anthropic },
  loaded: LoadedMessage,
  dict: Dictionary,
): Promise<ExtractResult> {
  const { date, time } = istDateTime(loaded.message.sentAt);
  const packet = userPacket({
    groupName: loaded.group.name,
    groupCommodities: loaded.group.primaryCommodities,
    sentAtIst: `${date} ${time}`,
    text: loaded.message.text!,
    quotedText: loaded.quotedText,
  });
  return callExtractor({ db: deps.db, client: deps.anthropic, config: deps.config }, loaded.message.id, systemPrompt(dict), packet);
}

/** Canonical commodity, market match, unit → ₹/quintal, and the in-code checks of each row. */
export function normalize(loaded: LoadedMessage, dict: Dictionary, output: ExtractionOutput) {
  const ctx: RowContext = {
    dict,
    text: packetText(loaded.message.text!),
    quotedText: loaded.quotedText ? packetText(loaded.quotedText) : null,
    groupCommodities: loaded.group.primaryCommodities,
    messageDate: istDateTime(loaded.message.sentAt).date,
  };
  const rows: NormalizedRow[] = [];
  const notes: string[] = [];
  output.rows.forEach((r, i) => {
    const result = normalizeRow(r, ctx);
    if (result.ok) rows.push(result.row);
    else notes.push(`row ${i + 1}: ${result.note}`);
  });
  return { rows, notes };
}

/** A price further than this from the 30-day median of its commodity and mandi goes to review. */
export const MAX_MEDIAN_DEVIATION = 0.4;
const BOUNDS_DAYS = 30;
const BOUNDS_MIN_SOURCES = 3;

/** Sanity bounds against recent trusted observations (auto or approved). Adds `out_of_bounds`. */
export async function validate(db: Db, rows: NormalizedRow[]): Promise<NormalizedRow[]> {
  for (const row of rows) {
    const price = centralPerQuintal(row);
    if (price === null) continue;
    const from = new Date(Date.parse(`${row.obsDate}T00:00:00Z`) - BOUNDS_DAYS * 86_400_000).toISOString().slice(0, 10);
    const central = sql<number>`coalesce(${priceObservation.modalPerQuintal}, (${priceObservation.minPerQuintal} + ${priceObservation.maxPerQuintal}) / 2)`;
    const [stats] = await db
      .select({
        median: sql<number | null>`percentile_cont(0.5) within group (order by ${central})`,
        sources: sql<number>`count(${central})::int`,
      })
      .from(priceObservation)
      .where(
        and(
          eq(priceObservation.commodityId, row.commodityId),
          eq(priceObservation.marketId, row.marketId),
          inArray(priceObservation.status, ['auto', 'approved']),
          gte(priceObservation.obsDate, from),
          lt(priceObservation.obsDate, row.obsDate),
        ),
      );
    const median = stats?.median === null || stats?.median === undefined ? null : Number(stats.median);
    if (median && stats!.sources >= BOUNDS_MIN_SOURCES && Math.abs(price - median) / median > MAX_MEDIAN_DEVIATION) {
      row.reasons.push('out_of_bounds');
    }
  }
  return rows;
}

/**
 * Write the label, each price_observation and its extraction_event, in one transaction. Rows with a reason
 * go to needs_review. (Marking commodity × market × date dirty for aggregation lands with the aggregate job.)
 */
export async function store(
  db: Db,
  messageId: number,
  result: Extract<ExtractResult, { outcome: 'ok' }>,
  rows: NormalizedRow[],
  notes: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    if (await isLabelled(tx, messageId)) return;
    await tx
      .insert(messageLabel)
      .values({ messageId, label: result.output.label, confidence: 1, modelVersion: result.modelVersion });
    for (const row of rows) {
      const status = row.reasons.length ? 'needs_review' : 'auto';
      const [obs] = await tx
        .insert(priceObservation)
        .values({
          messageId,
          commodityId: row.commodityId,
          variety: row.variety,
          marketId: row.marketId,
          obsDate: row.obsDate,
          minRaw: row.minRaw,
          maxRaw: row.maxRaw,
          modalRaw: row.modalRaw,
          unitId: row.unitId,
          minPerQuintal: row.minPerQuintal,
          maxPerQuintal: row.maxPerQuintal,
          modalPerQuintal: row.modalPerQuintal,
          arrivalsQuintal: row.arrivalsQuintal,
          confidence: row.confidence,
          status,
        })
        .returning({ id: priceObservation.id });
      await tx.insert(extractionEvent).values({
        observationId: obs!.id,
        action: 'extracted',
        actor: `model:${result.modelVersion}`,
        after: { ...row, status, llm_call_id: result.llmCallId },
      });
    }
    await tx.update(llmCall).set({ notes }).where(eq(llmCall.id, result.llmCallId));
  });
}

export async function processMessage(deps: PipelineDeps, { messageId }: { messageId: number }) {
  const { db, anthropic } = deps;
  if (!(await dedupe(db, messageId))) return;
  const loaded = await loadMessage(db, messageId);
  if (!loaded) return;
  const dict = await loadDictionary(db);
  if (!(await classify(db, loaded, dict))) return;
  // Without a key the message waits, unlabelled, for `extract-pending`.
  if (!anthropic) return;

  const result = await extract({ ...deps, anthropic }, loaded, dict);
  if (result.outcome !== 'ok') return;
  const { rows, notes } = normalize(loaded, dict, result.output);
  await store(db, messageId, result, await validate(db, rows), notes);
}

/**
 * Text messages the chain has not finished: no label and no model call yet. Messages ingested while
 * ANTHROPIC_API_KEY was unset wait here. A message whose call was refused or cut off is not retried.
 */
export async function pendingExtraction(db: Db, limit: number): Promise<number[]> {
  const rows = await db
    .select({ id: waMessage.id })
    .from(waMessage)
    .where(
      and(
        eq(waMessage.type, 'text'),
        notExists(db.select({ one: sql`1` }).from(messageLabel).where(eq(messageLabel.messageId, waMessage.id))),
        notExists(db.select({ one: sql`1` }).from(llmCall).where(eq(llmCall.messageId, waMessage.id))),
      ),
    )
    .orderBy(asc(waMessage.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Vision extraction for rate-sheet images and PDFs. */
export async function ocrMedia(_db: Db, _data: { mediaId: number }) {}

export async function aggregateDirty(_db: Db) {}
export async function aggregateFullRebuild(_db: Db) {}
export async function generateInsights(_db: Db) {}
export async function generateDailyBrief(_db: Db) {}
export async function proposeDictionaryAliases(_db: Db) {}

/**
 * Mark devices silent after 30 minutes without a heartbeat. Returns the ids marked.
 * The second parameter is the job data ({} from the scheduler), so `now` comes third.
 */
export async function collectorWatchdog(db: Db, _data?: unknown, now = new Date()): Promise<number[]> {
  const cutoff = new Date(now.getTime() - WATCHDOG_SILENCE_MS);
  const silent = await db
    .update(collectorDevice)
    .set({ status: 'silent' })
    .where(and(eq(collectorDevice.status, 'active'), lt(collectorDevice.lastHeartbeatAt, cutoff)))
    .returning({ id: collectorDevice.id, name: collectorDevice.name });
  for (const d of silent) console.warn(`Collector ${d.id} (${d.name}) is silent`);
  return silent.map((d) => d.id);
}

/** Every job, called as handler(deps, job.data) by the worker and the inline queue. */
export const handlers = {
  'process-message': processMessage,
  'ocr-media': (d: PipelineDeps, data: { mediaId: number }) => ocrMedia(d.db, data),
  'aggregate-dirty': (d: PipelineDeps) => aggregateDirty(d.db),
  'aggregate-full-rebuild': (d: PipelineDeps) => aggregateFullRebuild(d.db),
  'generate-insights': (d: PipelineDeps) => generateInsights(d.db),
  'generate-daily-brief': (d: PipelineDeps) => generateDailyBrief(d.db),
  'collector-watchdog': (d: PipelineDeps, data?: unknown) => collectorWatchdog(d.db, data),
  'propose-dictionary-aliases': (d: PipelineDeps) => proposeDictionaryAliases(d.db),
} as const;

export type JobName = keyof typeof handlers;
export type JobData<N extends JobName> = Parameters<(typeof handlers)[N]>[1];
