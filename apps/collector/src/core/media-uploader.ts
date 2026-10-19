import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { ApiError, signedUrlPut, type CollectorApi, type PutFile } from './api-client.js';
import { isPermissionError } from './disk-access.js';
import {
  isUploadableMime,
  MAX_MEDIA_BYTES,
  PENDING_MEDIA_MAX_AGE_MS,
  type MediaQueue,
  type MediaUpload,
} from './media-queue.js';
import { guessMime } from './reader.js';
import { MEDIA_ROOTS_FROM_DB_DIR } from './whatsapp-schema.js';

export const DEFAULT_MEDIA_PER_RUN = 20;
/** Uploads that keep failing with a client error are given up after this many attempts. */
export const MAX_MEDIA_ATTEMPTS = 10;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

/** The API's local-dev upload URL (no GCP credentials): nothing listens there, so skip the PUT. */
const DEV_MEDIA_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/dev-media\//;

export function isDevMediaUrl(url: string): boolean {
  return DEV_MEDIA_URL.test(url);
}

/** Absolute folders that ZMEDIALOCALPATH may be relative to, for a given ChatStorage.sqlite. */
export function mediaRootsFor(waDbPath: string): string[] {
  const dbDir = dirname(waDbPath);
  return MEDIA_ROOTS_FROM_DB_DIR.map((r) => resolve(dbDir, r));
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * The first existing file for a WhatsApp media path under `roots`, or null when it is not on
 * disk (yet). Paths that would leave their root are never used. Permission errors are thrown.
 */
export async function resolveMediaFile(roots: readonly string[], localPath: string): Promise<string | null> {
  if (!localPath || isAbsolute(localPath)) return null;
  for (const root of roots) {
    const file = resolve(root, localPath);
    const rel = relative(root, file);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  return null;
}

export interface MediaUploaderOptions {
  api: Pick<CollectorApi, 'createMediaUploadUrl' | 'completeMediaUpload'>;
  queue: MediaQueue;
  /** Absolute folders the WhatsApp media paths are relative to (see mediaRootsFor). */
  mediaRoots: readonly string[];
  putFile?: PutFile;
  /** Uploads attempted per run; the rest wait for the next tick so message sync never stalls. */
  maxPerRun?: number;
  now?: () => Date;
}

export interface MediaRunResult {
  /** Pending rows whose file appeared and were queued for upload. */
  promoted: number;
  /** Pending rows given up because the file never arrived. */
  expired: number;
  uploaded: number;
  /** Uploads completed without a PUT (server already had the file, or the dev URL). */
  skippedPut: number;
  failed: number;
  /** Set when the run stopped early (offline, server error, auth, Full Disk Access). */
  error: string | null;
}

type Step = 'upload-url' | 'put' | 'complete';
type Outcome = 'next' | 'stop';

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Uploads image and PDF files of collected messages. Each run:
 *   1. pending_media → media_outbox once WhatsApp has the file on disk; give up after 7 days.
 *   2. For each due upload: sha256 → upload URL → PUT (skipped when the server already has the
 *      file, or for the dev URL) → complete. Progress is stored after each step, so a retry
 *      repeats only what is left.
 * Network and server errors stop the run and leave everything queued for the next tick.
 */
export class MediaUploader {
  private readonly putFile: PutFile;
  private readonly now: () => Date;

  constructor(private readonly opts: MediaUploaderOptions) {
    this.putFile = opts.putFile ?? signedUrlPut();
    this.now = opts.now ?? (() => new Date());
  }

  async run(): Promise<MediaRunResult> {
    const result: MediaRunResult = { promoted: 0, expired: 0, uploaded: 0, skippedPut: 0, failed: 0, error: null };
    try {
      await this.promotePending(result);
    } catch (err) {
      result.error = isPermissionError(err) ? 'Full Disk Access is needed to read WhatsApp media' : message(err);
      return result;
    }
    const due = this.opts.queue.dueUploads(this.now(), this.opts.maxPerRun ?? DEFAULT_MEDIA_PER_RUN);
    for (const item of due) {
      if ((await this.upload(item, result)) === 'stop') break;
    }
    return result;
  }

  private async promotePending(result: MediaRunResult): Promise<void> {
    const { queue, mediaRoots } = this.opts;
    const now = this.now();
    for (const p of queue.pending()) {
      if (p.localPath !== null) {
        const mime = guessMime(p.localPath, p.type);
        if (!isUploadableMime(mime)) {
          queue.dropPending(p.id);
          continue;
        }
        const file = await resolveMediaFile(mediaRoots, p.localPath);
        if (file) {
          queue.promote(p.id, file, mime, now);
          result.promoted++;
          continue;
        }
      }
      if (now.getTime() - p.firstSeenAt.getTime() >= PENDING_MEDIA_MAX_AGE_MS) {
        const why = p.localPath === null ? 'not downloaded by WhatsApp' : 'file not found on disk';
        queue.failPending(p.id, `gave up after 7 days: ${why}`, now);
        result.expired++;
      }
    }
  }

  private async upload(item: MediaUpload, result: MediaRunResult): Promise<Outcome> {
    const { api, queue } = this.opts;
    let step: Step = 'upload-url';
    try {
      let mediaId = item.mediaId;
      if (!item.putDone || mediaId === null) {
        let bytes: Buffer;
        try {
          bytes = await readFile(item.filePath);
        } catch (err) {
          if (!isMissing(err)) throw err;
          return this.giveUp(item, 'file deleted before upload', result);
        }
        if (bytes.length > MAX_MEDIA_BYTES) {
          return this.giveUp(item, `file too large (${bytes.length} bytes)`, result);
        }
        const res = await api.createMediaUploadUrl({
          group_jid: item.groupJid,
          stanza_id: item.stanzaId,
          mime: item.mime,
          size_bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
        if (res.already_uploaded || isDevMediaUrl(res.upload_url)) {
          result.skippedPut++;
        } else {
          step = 'put';
          await this.putFile(res.upload_url, bytes, item.mime);
        }
        mediaId = res.media_id;
        queue.markPutDone(item.id, mediaId);
      }
      step = 'complete';
      await api.completeMediaUpload(mediaId);
      queue.done(item.id);
      result.uploaded++;
      return 'next';
    } catch (err) {
      return this.handleError(item, step, err, result);
    }
  }

  private giveUp(item: MediaUpload, reason: string, result: MediaRunResult): Outcome {
    this.opts.queue.fail(item.id, reason, this.now());
    result.failed++;
    return 'next';
  }

  /** Count an attempt and back off; give up once the attempts run out. */
  private later(item: MediaUpload, error: string, result: MediaRunResult, restart = false): Outcome {
    if (item.attempts + 1 >= MAX_MEDIA_ATTEMPTS) {
      return this.giveUp(item, `gave up after ${MAX_MEDIA_ATTEMPTS} attempts: ${error}`, result);
    }
    this.opts.queue.retryLater(item.id, error, this.backoffFrom(item.attempts), { restart });
    return 'next';
  }

  private backoffFrom(attempts: number): Date {
    return new Date(this.now().getTime() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempts));
  }

  private handleError(item: MediaUpload, step: Step, err: unknown, result: MediaRunResult): Outcome {
    if (isPermissionError(err)) {
      result.error = 'Full Disk Access is needed to read WhatsApp media';
      return 'stop';
    }
    if (!(err instanceof ApiError)) return this.later(item, message(err), result);

    // Offline, timeouts, 429: keep the row as it is and try the whole queue next tick.
    if (err.retryable && (err.status === 0 || err.status === 408 || err.status === 429)) {
      result.error = err.message;
      return 'stop';
    }
    // 5xx: may be this file only. Back off this row (not counted as an attempt) and go on, so one
    // file the server keeps failing on never blocks the others.
    if (err.retryable) {
      result.error = err.message;
      this.opts.queue.retryLater(item.id, err.message, this.backoffFrom(item.attempts), { countAttempt: false });
      return 'next';
    }
    // A revoked or wrong device token affects every upload; nothing to give up on.
    if (step !== 'put' && (err.status === 401 || err.status === 403)) {
      result.error = err.message;
      return 'stop';
    }
    switch (step) {
      case 'put':
        // Expired or rejected signature: ask for a fresh URL next time.
        return this.later(item, err.message, result, true);
      case 'complete':
        // The server lost the media row: start over.
        return this.later(item, err.message, result, err.status === 404);
      case 'upload-url':
        // 404: the server does not have the message (yet). Other 4xx: the request is invalid.
        return err.status === 404 ? this.later(item, err.message, result) : this.giveUp(item, err.message, result);
    }
  }
}
