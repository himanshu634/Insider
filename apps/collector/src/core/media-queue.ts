import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './sqlite.js';
import type { MessageType } from './types.js';

/** Message types whose file may be an image or a PDF. The real MIME is known once the file is. */
export const MEDIA_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set<MessageType>(['image', 'document']);

/** MediaUploadUrlRequest.size_bytes maximum in openapi.yaml. */
export const MAX_MEDIA_BYTES = 52_428_800;

/** Give up on a file WhatsApp has not downloaded after this long. */
export const PENDING_MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The rate sheets we OCR: images and PDFs. Everything else is never uploaded. */
export function isUploadableMime(mime: string): boolean {
  return mime.startsWith('image/') || mime === 'application/pdf';
}

export const MEDIA_SCHEMA = `
  CREATE TABLE IF NOT EXISTS pending_media (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid     TEXT NOT NULL,
    stanza_id     TEXT NOT NULL,
    type          TEXT NOT NULL,
    media_item_pk INTEGER NOT NULL,
    local_path    TEXT,
    first_seen_at TEXT NOT NULL,
    checked_at    TEXT NOT NULL,
    UNIQUE (group_jid, stanza_id)
  );
  CREATE TABLE IF NOT EXISTS media_outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid       TEXT NOT NULL,
    stanza_id       TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    mime            TEXT NOT NULL,
    media_id        INTEGER,
    put_done        INTEGER NOT NULL DEFAULT 0,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    next_attempt_at TEXT NOT NULL,
    enqueued_at     TEXT NOT NULL,
    UNIQUE (group_jid, stanza_id)
  );
  CREATE TABLE IF NOT EXISTS media_failed (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid TEXT NOT NULL,
    stanza_id TEXT NOT NULL,
    path      TEXT,
    reason    TEXT NOT NULL,
    failed_at TEXT NOT NULL
  );
`;

/** A media message whose file is not on disk yet (or whose path we have not resolved yet). */
export interface PendingMedia {
  id: number;
  groupJid: string;
  stanzaId: string;
  type: MessageType;
  /** ZWAMEDIAITEM.Z_PK, to re-read ZMEDIALOCALPATH from later snapshots. */
  itemPk: number;
  /** ZMEDIALOCALPATH; null while WhatsApp has not downloaded the file. */
  localPath: string | null;
  firstSeenAt: Date;
}

/** A file on disk, waiting to be uploaded. */
export interface MediaUpload {
  id: number;
  groupJid: string;
  stanzaId: string;
  filePath: string;
  mime: string;
  /** Server media id; set once the file is in the bucket (PUT done or already uploaded). */
  mediaId: number | null;
  putDone: boolean;
  attempts: number;
}

export interface FailedMedia {
  groupJid: string;
  stanzaId: string;
  path: string | null;
  reason: string;
  failedAt: string;
}

const UPLOAD_COLUMNS =
  'm.id, m.group_jid, m.stanza_id, m.file_path, m.mime, m.media_id, m.put_done, m.attempts';

function toUpload(r: Record<string, unknown>): MediaUpload {
  return {
    id: Number(r.id),
    groupJid: String(r.group_jid),
    stanzaId: String(r.stanza_id),
    filePath: String(r.file_path),
    mime: String(r.mime),
    mediaId: r.media_id === null ? null : Number(r.media_id),
    putDone: Number(r.put_done) === 1,
    attempts: Number(r.attempts),
  };
}

/**
 * Media tables in the outbox SQLite file. A media message goes
 * pending_media (until the file is on disk) → media_outbox (until uploaded and completed) → gone,
 * or into media_failed (gave up; kept for inspection, never retried).
 */
export class MediaQueue {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Remember a media message. Call inside the transaction that queues the message and moves its
   * checkpoint, so a checkpoint never passes a media message we have not recorded.
   */
  addPending(
    groupJid: string,
    stanzaId: string,
    type: MessageType,
    itemPk: number,
    localPath: string | null,
    at: string,
  ): number {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO pending_media
           (group_jid, stanza_id, type, media_item_pk, local_path, first_seen_at, checked_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM media_outbox WHERE group_jid = ? AND stanza_id = ?)`,
      )
      .run(groupJid, stanzaId, type, itemPk, localPath, at, at, groupJid, stanzaId);
    return Number(res.changes);
  }

  /** Media items whose ZMEDIALOCALPATH was still NULL: re-read these from the next snapshot. */
  pendingItemPksWithoutPath(): number[] {
    return this.db
      .prepare('SELECT DISTINCT media_item_pk FROM pending_media WHERE local_path IS NULL')
      .all()
      .map((r) => Number(r.media_item_pk));
  }

  /** Store paths re-read from a snapshot (only fills paths that were NULL). */
  updatePendingPaths(paths: ReadonlyMap<number, string | null>, now: Date = new Date()): void {
    if (paths.size === 0) return;
    const update = this.db.prepare(
      `UPDATE pending_media SET local_path = COALESCE(local_path, ?), checked_at = ?
        WHERE media_item_pk = ?`,
    );
    const at = now.toISOString();
    transaction(this.db, () => {
      for (const [pk, path] of paths) update.run(path, at, pk);
    });
  }

  pending(): PendingMedia[] {
    return this.db
      .prepare(
        `SELECT id, group_jid, stanza_id, type, media_item_pk, local_path, first_seen_at
           FROM pending_media ORDER BY id`,
      )
      .all()
      .map((r) => ({
        id: Number(r.id),
        groupJid: String(r.group_jid),
        stanzaId: String(r.stanza_id),
        type: String(r.type) as MessageType,
        itemPk: Number(r.media_item_pk),
        localPath: r.local_path === null ? null : String(r.local_path),
        firstSeenAt: new Date(String(r.first_seen_at)),
      }));
  }

  /** The file is on disk: move the row to the upload queue. */
  promote(id: number, filePath: string, mime: string, now: Date = new Date()): void {
    const at = now.toISOString();
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO media_outbox (group_jid, stanza_id, file_path, mime, next_attempt_at, enqueued_at)
           SELECT group_jid, stanza_id, ?, ?, ?, ? FROM pending_media WHERE id = ?`,
        )
        .run(filePath, mime, at, at, id);
      this.db.prepare('DELETE FROM pending_media WHERE id = ?').run(id);
    });
  }

  /** Forget a pending row (the file turned out not to be an image or PDF). */
  dropPending(id: number): void {
    this.db.prepare('DELETE FROM pending_media WHERE id = ?').run(id);
  }

  failPending(id: number, reason: string, now: Date = new Date()): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO media_failed (group_jid, stanza_id, path, reason, failed_at)
           SELECT group_jid, stanza_id, local_path, ?, ? FROM pending_media WHERE id = ?`,
        )
        .run(reason, now.toISOString(), id);
      this.db.prepare('DELETE FROM pending_media WHERE id = ?').run(id);
    });
  }

  /**
   * Uploads that are due, oldest first. A file waits until its message has left the message
   * outbox: the API only hands out upload URLs for messages it already has.
   */
  dueUploads(now: Date, limit: number): MediaUpload[] {
    return this.db
      .prepare(
        `SELECT ${UPLOAD_COLUMNS}
           FROM media_outbox m
          WHERE m.next_attempt_at <= ?
            AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.group_jid = m.group_jid AND o.stanza_id = m.stanza_id)
          ORDER BY m.id
          LIMIT ?`,
      )
      .all(now.toISOString(), Math.max(1, limit))
      .map(toUpload);
  }

  /** The file is in the bucket (PUT done, or the server already had it); only complete is left. */
  markPutDone(id: number, mediaId: number): void {
    this.db.prepare('UPDATE media_outbox SET put_done = 1, media_id = ? WHERE id = ?').run(mediaId, id);
  }

  /**
   * Try again at `nextAttemptAt`. `countAttempt: false` for server errors that say nothing about
   * this file. `restart` forgets the server media id so the next attempt asks for a fresh URL.
   */
  retryLater(
    id: number,
    error: string,
    nextAttemptAt: Date,
    { restart = false, countAttempt = true }: { restart?: boolean; countAttempt?: boolean } = {},
  ): void {
    this.db
      .prepare(
        `UPDATE media_outbox
            SET attempts = attempts + ?, last_error = ?, next_attempt_at = ?,
                put_done = CASE WHEN ? THEN 0 ELSE put_done END,
                media_id = CASE WHEN ? THEN NULL ELSE media_id END
          WHERE id = ?`,
      )
      .run(countAttempt ? 1 : 0, error, nextAttemptAt.toISOString(), restart ? 1 : 0, restart ? 1 : 0, id);
  }

  /** Uploaded and completed. */
  done(id: number): void {
    this.db.prepare('DELETE FROM media_outbox WHERE id = ?').run(id);
  }

  fail(id: number, reason: string, now: Date = new Date()): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO media_failed (group_jid, stanza_id, path, reason, failed_at)
           SELECT group_jid, stanza_id, file_path, ?, ? FROM media_outbox WHERE id = ?`,
        )
        .run(reason, now.toISOString(), id);
      this.db.prepare('DELETE FROM media_outbox WHERE id = ?').run(id);
    });
  }

  /**
   * Give up on the media of one message (the server rejected the message, so it will never take
   * the file). Does not open a transaction: call it inside the caller's.
   */
  failForMessage(groupJid: string, stanzaId: string, reason: string, at: string): void {
    for (const [table, pathColumn] of [
      ['pending_media', 'local_path'],
      ['media_outbox', 'file_path'],
    ] as const) {
      this.db
        .prepare(
          `INSERT INTO media_failed (group_jid, stanza_id, path, reason, failed_at)
           SELECT group_jid, stanza_id, ${pathColumn}, ?, ? FROM ${table} WHERE group_jid = ? AND stanza_id = ?`,
        )
        .run(reason, at, groupJid, stanzaId);
      this.db.prepare(`DELETE FROM ${table} WHERE group_jid = ? AND stanza_id = ?`).run(groupJid, stanzaId);
    }
  }

  /** Media still to upload: waiting for the file plus queued for upload. */
  waitingCount(): number {
    const row = this.db
      .prepare('SELECT (SELECT COUNT(*) FROM pending_media) + (SELECT COUNT(*) FROM media_outbox) AS n')
      .get();
    return Number(row?.n ?? 0);
  }

  failed(): FailedMedia[] {
    return this.db
      .prepare('SELECT group_jid, stanza_id, path, reason, failed_at FROM media_failed ORDER BY id')
      .all()
      .map((r) => ({
        groupJid: String(r.group_jid),
        stanzaId: String(r.stanza_id),
        path: r.path === null ? null : String(r.path),
        reason: String(r.reason),
        failedAt: String(r.failed_at),
      }));
  }

  /** Every queued upload, due or not (for inspection and tests). */
  uploads(): MediaUpload[] {
    return this.db.prepare(`SELECT ${UPLOAD_COLUMNS} FROM media_outbox m ORDER BY m.id`).all().map(toUpload);
  }
}
