import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MAX_BATCH, type IngestMessage } from './types.js';

export interface OutboxItem {
  id: number;
  message: IngestMessage;
}

export interface EnqueueInput {
  groupJid: string;
  message: IngestMessage;
}

/** Local calendar day, `YYYY-MM-DD` (the Mac runs on IST). */
export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const SCHEMA_VERSION = 1;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS outbox (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid   TEXT NOT NULL,
    stanza_id   TEXT NOT NULL,
    payload     TEXT NOT NULL,
    enqueued_at TEXT NOT NULL,
    UNIQUE (group_jid, stanza_id)
  );
  CREATE TABLE IF NOT EXISTS checkpoints (
    group_jid  TEXT PRIMARY KEY,
    last_pk    INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rejected (
    id          INTEGER PRIMARY KEY,
    group_jid   TEXT NOT NULL,
    stanza_id   TEXT NOT NULL,
    payload     TEXT NOT NULL,
    error       TEXT,
    rejected_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS daily_sent (
    day   TEXT PRIMARY KEY,
    count INTEGER NOT NULL
  );
`;

/**
 * The collector's own SQLite file: messages waiting for upload, plus the last WhatsApp Z_PK read
 * per group. A message and the checkpoint that covers it are written in one transaction, so a
 * crash can never skip a message (it can only re-read one, and ingest is idempotent).
 */
export class Outbox {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string): Outbox {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return new Outbox(db);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Queue `messages` and advance the per-group checkpoints in ONE transaction. Checkpoints only
   * move forward. Returns how many messages were newly queued (duplicates are ignored).
   */
  enqueue(
    messages: readonly EnqueueInput[],
    checkpoints: ReadonlyMap<string, number>,
    now: Date = new Date(),
  ): number {
    const insert = this.db.prepare(
      `INSERT INTO outbox (group_jid, stanza_id, payload, enqueued_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (group_jid, stanza_id) DO NOTHING`,
    );
    const advance = this.db.prepare(
      `INSERT INTO checkpoints (group_jid, last_pk, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (group_jid) DO UPDATE
         SET last_pk = MAX(last_pk, excluded.last_pk), updated_at = excluded.updated_at`,
    );
    const at = now.toISOString();
    return this.transaction(() => {
      let added = 0;
      for (const { groupJid, message } of messages) {
        const payload = JSON.stringify(message);
        added += Number(insert.run(groupJid, message.stanza_id, payload, at).changes);
      }
      for (const [groupJid, pk] of checkpoints) advance.run(groupJid, pk, at);
      return added;
    });
  }

  checkpoints(): Map<string, number> {
    const rows = this.db.prepare('SELECT group_jid, last_pk FROM checkpoints').all();
    return new Map(rows.map((r) => [String(r.group_jid), Number(r.last_pk)]));
  }

  /** Oldest queued messages first, at most `limit` (capped at the API's 500). */
  nextBatch(limit: number = MAX_BATCH): OutboxItem[] {
    const n = Math.max(1, Math.min(limit, MAX_BATCH));
    const rows = this.db.prepare('SELECT id, payload FROM outbox ORDER BY id LIMIT ?').all(n);
    return rows.map((r) => ({
      id: Number(r.id),
      message: JSON.parse(String(r.payload)) as IngestMessage,
    }));
  }

  /** Remove uploaded (accepted or duplicate) messages and count them for today. */
  markSent(ids: readonly number[], now: Date = new Date()): void {
    if (ids.length === 0) return;
    const del = this.db.prepare('DELETE FROM outbox WHERE id = ?');
    const count = this.db.prepare(
      `INSERT INTO daily_sent (day, count) VALUES (?, ?)
       ON CONFLICT (day) DO UPDATE SET count = count + excluded.count`,
    );
    this.transaction(() => {
      let removed = 0;
      for (const id of ids) removed += Number(del.run(id).changes);
      if (removed > 0) count.run(localDay(now), removed);
    });
  }

  /** Move messages the server rejected out of the queue (kept for inspection, never retried). */
  markRejected(items: readonly { id: number; error?: string | null }[], now: Date = new Date()): void {
    if (items.length === 0) return;
    const move = this.db.prepare(
      `INSERT OR REPLACE INTO rejected (id, group_jid, stanza_id, payload, error, rejected_at)
       SELECT id, group_jid, stanza_id, payload, ?, ? FROM outbox WHERE id = ?`,
    );
    const del = this.db.prepare('DELETE FROM outbox WHERE id = ?');
    const at = now.toISOString();
    this.transaction(() => {
      for (const { id, error } of items) {
        move.run(error ?? null, at, id);
        del.run(id);
      }
    });
  }

  size(): number {
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM outbox').get()?.n ?? 0);
  }

  rejectedCount(): number {
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM rejected').get()?.n ?? 0);
  }

  /** Messages uploaded on a local day (`YYYY-MM-DD`). */
  sentOn(day: string): number {
    return Number(this.db.prepare('SELECT count FROM daily_sent WHERE day = ?').get(day)?.count ?? 0);
  }
}
