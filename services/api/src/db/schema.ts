/**
 * Every Insider table lives in the `market_intel` Postgres schema. Raw messages and extraction
 * events are append-only. Prices are stored as reported and normalized to ₹/quintal.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const marketIntel = pgSchema('market_intel');

const id = () => bigserial('id', { mode: 'number' }).primaryKey();
const ref = (name: string) => bigint(name, { mode: 'number' });
const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => tsz('created_at').notNull().defaultNow();
const strings = (name: string) =>
  jsonb(name).$type<string[]>().notNull().default(sql`'[]'::jsonb`);

// ---------------------------------------------------------------- enums

export const deviceStatus = marketIntel.enum('device_status', [
  'active',
  'paused',
  'silent',
  'schema_mismatch',
  'revoked',
]);
export const messageType = marketIntel.enum('message_type', [
  'text',
  'image',
  'document',
  'audio',
  'video',
  'sticker',
  'location',
  'contact',
  'system',
  'other',
]);
export const ocrStatus = marketIntel.enum('ocr_status', ['pending', 'done', 'failed', 'skipped']);
export const messageLabelValue = marketIntel.enum('message_label_value', [
  'price',
  'arrivals',
  'news',
  'advisory',
  'noise',
]);
export const observationStatus = marketIntel.enum('observation_status', [
  'auto',
  'needs_review',
  'approved',
  'rejected',
]);
export const extractionAction = marketIntel.enum('extraction_action', [
  'extracted',
  'approved',
  'edited',
  'rejected',
]);
export const qualityFlag = marketIntel.enum('quality_flag', [
  'ok',
  'single_source',
  'conflicting',
  'out_of_bounds',
]);
export const insightType = marketIntel.enum('insight_type', [
  'price_move',
  'spread',
  'arrival_spike',
  'conflict',
  'news',
]);
export const severity = marketIntel.enum('severity', ['info', 'notable', 'high']);
export const llmCallOutcome = marketIntel.enum('llm_call_outcome', [
  'ok',
  'refusal',
  'max_tokens',
  'invalid_output',
]);

// ---------------------------------------------------------------- collection

export const collectorDevice = marketIntel.table('collector_device', {
  id: id(),
  name: varchar('name', { length: 128 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  appVersion: varchar('app_version', { length: 32 }),
  schemaFingerprint: varchar('schema_fingerprint', { length: 128 }),
  schemaOk: boolean('schema_ok').notNull().default(true),
  outboxSize: integer('outbox_size'),
  lastHeartbeatAt: tsz('last_heartbeat_at'),
  lastSyncAt: tsz('last_sync_at'),
  paused: boolean('paused').notNull().default(false),
  status: deviceStatus('status').notNull().default('active'),
  createdAt: createdAt(),
});

export const waGroup = marketIntel.table('wa_group', {
  id: id(),
  jid: varchar('jid', { length: 128 }).notNull().unique(),
  name: varchar('name', { length: 256 }).notNull(),
  memberCount: integer('member_count'),
  isWatched: boolean('is_watched').notNull().default(false),
  regionTag: varchar('region_tag', { length: 64 }),
  primaryCommodities: strings('primary_commodities'),
  lastMessageAt: tsz('last_message_at'),
  createdAt: createdAt(),
});

/** The same post forwarded across groups. */
export const contentCluster = marketIntel.table('content_cluster', {
  id: id(),
  contentHash: varchar('content_hash', { length: 64 }).notNull().unique(),
  canonicalMessageId: ref('canonical_message_id').references((): AnyPgColumn => waMessage.id, {
    onDelete: 'set null',
  }),
  groupCount: integer('group_count').notNull().default(1),
  firstSeenAt: tsz('first_seen_at').notNull().defaultNow(),
});

/** Raw messages. Append-only. */
export const waMessage = marketIntel.table(
  'wa_message',
  {
    id: id(),
    groupId: ref('group_id')
      .notNull()
      .references(() => waGroup.id),
    deviceId: ref('device_id').references(() => collectorDevice.id),
    stanzaId: varchar('stanza_id', { length: 128 }).notNull(),
    senderHash: varchar('sender_hash', { length: 64 }).notNull(),
    senderName: varchar('sender_name', { length: 256 }),
    sentAt: tsz('sent_at').notNull(),
    type: messageType('type').notNull(),
    text: text('text'),
    quotedStanzaId: varchar('quoted_stanza_id', { length: 128 }),
    isForwarded: boolean('is_forwarded').notNull().default(false),
    contentHash: varchar('content_hash', { length: 64 }),
    clusterId: ref('cluster_id').references((): AnyPgColumn => contentCluster.id),
    ingestedAt: tsz('ingested_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('wa_message_group_stanza_uq').on(t.groupId, t.stanzaId),
    index('wa_message_group_sent_idx').on(t.groupId, t.sentAt),
    index('wa_message_content_hash_idx').on(t.contentHash),
  ],
);

export const waMedia = marketIntel.table(
  'wa_media',
  {
    id: id(),
    messageId: ref('message_id')
      .notNull()
      .references(() => waMessage.id),
    gcsPath: varchar('gcs_path', { length: 512 }).notNull(),
    mime: varchar('mime', { length: 128 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    uploaded: boolean('uploaded').notNull().default(false),
    ocrStatus: ocrStatus('ocr_status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [index('wa_media_message_idx').on(t.messageId), index('wa_media_sha256_idx').on(t.sha256)],
);

/** Classifier output: one label per message. */
export const messageLabel = marketIntel.table(
  'message_label',
  {
    id: id(),
    messageId: ref('message_id')
      .notNull()
      .references(() => waMessage.id),
    label: messageLabelValue('label').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    modelVersion: varchar('model_version', { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('message_label_message_uq').on(t.messageId)],
);

// ---------------------------------------------------------------- dictionaries

export const commodity = marketIntel.table('commodity', {
  id: id(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 128 }).notNull(),
  varieties: strings('varieties'),
  /** Gujarati, Hindi and Gujlish spellings */
  synonyms: strings('synonyms'),
});

export const market = marketIntel.table('market', {
  id: id(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 128 }).notNull(),
  district: varchar('district', { length: 128 }),
  state: varchar('state', { length: 64 }).notNull(),
  aliases: strings('aliases'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
});

export const unit = marketIntel.table('unit', {
  id: id(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  label: varchar('label', { length: 64 }).notNull(),
  /** Multiply a price in this unit by this factor to get ₹/quintal. */
  factorToQuintal: doublePrecision('factor_to_quintal').notNull(),
  aliases: strings('aliases'),
});

// ---------------------------------------------------------------- prices

/** One price for one commodity at one market on one date, from one message. */
export const priceObservation = marketIntel.table(
  'price_observation',
  {
    id: id(),
    messageId: ref('message_id')
      .notNull()
      .references(() => waMessage.id),
    commodityId: ref('commodity_id')
      .notNull()
      .references(() => commodity.id),
    variety: varchar('variety', { length: 64 }),
    marketId: ref('market_id')
      .notNull()
      .references(() => market.id),
    obsDate: date('obs_date', { mode: 'string' }).notNull(),
    minRaw: doublePrecision('min_raw'),
    maxRaw: doublePrecision('max_raw'),
    modalRaw: doublePrecision('modal_raw'),
    unitId: ref('unit_id')
      .notNull()
      .references(() => unit.id),
    minPerQuintal: doublePrecision('min_per_quintal'),
    maxPerQuintal: doublePrecision('max_per_quintal'),
    modalPerQuintal: doublePrecision('modal_per_quintal'),
    arrivalsQuintal: doublePrecision('arrivals_quintal'),
    confidence: doublePrecision('confidence').notNull(),
    status: observationStatus('status').notNull().default('auto'),
    createdAt: createdAt(),
  },
  (t) => [
    index('price_observation_cmd_idx').on(t.commodityId, t.marketId, t.obsDate),
    index('price_observation_message_idx').on(t.messageId),
    index('price_observation_status_idx').on(t.status),
  ],
);

/** Audit trail of every extraction and human edit. Append-only. */
export const extractionEvent = marketIntel.table(
  'extraction_event',
  {
    id: id(),
    observationId: ref('observation_id')
      .notNull()
      .references(() => priceObservation.id),
    action: extractionAction('action').notNull(),
    /** "model:<version>" or "user:<id>" */
    actor: varchar('actor', { length: 128 }).notNull(),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('extraction_event_observation_idx').on(t.observationId)],
);

/**
 * One row per pipeline call to a model, with the full request so it can be replayed. The request holds only
 * scrubbed message text: no sender names, phone numbers or JIDs. `notes` is filled in when the rows are stored.
 */
export const llmCall = marketIntel.table(
  'llm_call',
  {
    id: id(),
    messageId: ref('message_id')
      .notNull()
      .references(() => waMessage.id),
    /** extract, later classify, ocr … */
    purpose: varchar('purpose', { length: 32 }).notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 32 }).notNull(),
    /** sha256 of the request body */
    packetHash: varchar('packet_hash', { length: 64 }).notNull(),
    request: jsonb('request').$type<Record<string, unknown>>().notNull(),
    response: jsonb('response').$type<Record<string, unknown>>(),
    stopReason: varchar('stop_reason', { length: 32 }),
    outcome: llmCallOutcome('outcome').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** Why rows of the output were not stored: "row 2: unknown_market Gondl" … */
    notes: strings('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('llm_call_message_idx').on(t.messageId)],
);

/** Aggregate per commodity × market × date, rebuilt by the aggregate job. */
export const dailyPrice = marketIntel.table(
  'daily_price',
  {
    id: id(),
    commodityId: ref('commodity_id')
      .notNull()
      .references(() => commodity.id),
    marketId: ref('market_id')
      .notNull()
      .references(() => market.id),
    date: date('date', { mode: 'string' }).notNull(),
    medianModal: doublePrecision('median_modal').notNull(),
    min: doublePrecision('min'),
    max: doublePrecision('max'),
    arrivalsQuintal: doublePrecision('arrivals_quintal'),
    sourceCount: integer('source_count').notNull(),
    groupCount: integer('group_count').notNull(),
    qualityFlag: qualityFlag('quality_flag').notNull(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('daily_price_cmd_uq').on(t.commodityId, t.marketId, t.date)],
);

// ---------------------------------------------------------------- insights

export const insight = marketIntel.table(
  'insight',
  {
    id: id(),
    date: date('date', { mode: 'string' }).notNull(),
    type: insightType('type').notNull(),
    commodityId: ref('commodity_id').references(() => commodity.id),
    marketId: ref('market_id').references(() => market.id),
    severity: severity('severity').notNull(),
    title: varchar('title', { length: 256 }).notNull(),
    detail: text('detail').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('insight_date_type_idx').on(t.date, t.type)],
);

export const dailyBrief = marketIntel.table('daily_brief', {
  id: id(),
  date: date('date', { mode: 'string' }).notNull().unique(),
  body: text('body').notNull(),
  generatedAt: tsz('generated_at'),
  deliveredAt: tsz('delivered_at'),
});
