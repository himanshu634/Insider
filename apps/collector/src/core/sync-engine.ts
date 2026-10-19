import type { CollectorApi, PutFile } from './api-client.js';
import { isPermissionError } from './disk-access.js';
import { MediaUploader, mediaRootsFor } from './media-uploader.js';
import { localDay, type Outbox } from './outbox.js';
import { DEFAULT_READ_LIMIT, WhatsAppReader } from './reader.js';
import { checkSchema } from './schema-guard.js';
import { createSnapshot, type Snapshot } from './snapshot.js';
import { GROUP_JID_SUFFIX } from './whatsapp-schema.js';
import type { DeviceConfig, GroupCatalogResponse } from './types.js';

export interface SyncStatus {
  /** End of the last tick that finished without any error. */
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  sentToday: number;
  outboxSize: number;
  /** Media files waiting for WhatsApp to download them, or for upload. */
  mediaWaiting: number;
  /** null until the first snapshot has been checked. */
  schemaOk: boolean | null;
  schemaFingerprint: string | null;
  missingColumns: string[];
  watchedGroups: number;
  serverPaused: boolean;
  syncing: boolean;
  error: string | null;
}

export interface SyncEngineOptions {
  waDbPath: string;
  /**
   * Fallback for dev (SENDER_HMAC_KEY). The key from the server's device config wins; without
   * either, the engine reads no messages.
   */
  senderHmacKey: string | undefined;
  api: CollectorApi;
  outbox: Outbox;
  /** Where snapshots are copied (and deleted again). */
  workDir: string;
  appVersion: string;
  /** Max WhatsApp rows read per tick; the rest follow on the next tick. */
  readLimit?: number;
  /** Folders WhatsApp media paths are relative to. Default: derived from waDbPath. */
  mediaRoots?: readonly string[];
  /** Media uploads per tick (the rest follow on later ticks). */
  mediaPerTick?: number;
  /** PUT to a signed URL (tests inject a fake). */
  putFile?: PutFile;
  selfJid?: string;
  now?: () => Date;
  onStatus?: (status: SyncStatus) => void;
}

function describeError(err: unknown, waDbPath: string): string {
  if (isPermissionError(err)) return 'Full Disk Access is needed to read the WhatsApp database';
  if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return `WhatsApp database not found at ${waDbPath}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * One tick: device config → snapshot → schema guard → read new messages of watched groups and
 * re-check media still waiting for its file → outbox (+ checkpoints + pending media, one
 * transaction) → delete the snapshot → upload messages in batches → upload media.
 * Ticks never overlap; calling tick() while one runs returns the running tick.
 */
export class SyncEngine {
  private running: Promise<SyncStatus> | null = null;
  private deviceConfig: DeviceConfig | null = null;
  private readonly now: () => Date;
  private readonly state: SyncStatus;
  private readonly media: MediaUploader;

  constructor(private readonly opts: SyncEngineOptions) {
    this.now = opts.now ?? (() => new Date());
    this.media = new MediaUploader({
      api: opts.api,
      queue: opts.outbox.media,
      mediaRoots: opts.mediaRoots ?? mediaRootsFor(opts.waDbPath),
      now: this.now,
      ...(opts.putFile ? { putFile: opts.putFile } : {}),
      ...(opts.mediaPerTick ? { maxPerRun: opts.mediaPerTick } : {}),
    });
    this.state = {
      lastSyncAt: null,
      lastAttemptAt: null,
      sentToday: opts.outbox.sentOn(localDay(this.now())),
      outboxSize: opts.outbox.size(),
      mediaWaiting: opts.outbox.media.waitingCount(),
      schemaOk: null,
      schemaFingerprint: null,
      missingColumns: [],
      watchedGroups: 0,
      serverPaused: false,
      syncing: false,
      error: null,
    };
  }

  get status(): SyncStatus {
    return { ...this.state, missingColumns: [...this.state.missingColumns] };
  }

  /** Last device config received from the API (null until the first successful fetch). */
  get config(): DeviceConfig | null {
    return this.deviceConfig;
  }

  tick(): Promise<SyncStatus> {
    if (!this.running) {
      this.running = this.runTick().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  /** Resolves when no tick is running (to swap engines without two ticks at once). */
  async whenIdle(): Promise<void> {
    await this.running?.catch(() => undefined);
  }

  private emit(): void {
    this.opts.onStatus?.(this.status);
  }

  private async runTick(): Promise<SyncStatus> {
    const { api, outbox } = this.opts;
    const errors: string[] = [];
    // Shown in the status, but media trouble does not hold back "last sync" (messages flowed).
    let mediaError: string | null = null;
    this.state.syncing = true;
    this.emit();

    try {
      try {
        this.deviceConfig = await api.getDeviceConfig();
      } catch (err) {
        // Offline: keep collecting with the last known config, if any.
        if (!this.deviceConfig) errors.push(`device config: ${describeError(err, this.opts.waDbPath)}`);
      }

      const config = this.deviceConfig;
      this.state.serverPaused = config?.paused ?? false;
      const watched = (config?.watched_group_jids ?? []).filter((j) => j.endsWith(GROUP_JID_SUFFIX));
      this.state.watchedGroups = watched.length;

      if (config && !config.paused) {
        const key = config.sender_hmac_key || this.opts.senderHmacKey;
        if (!key) {
          errors.push('No sender HMAC key from the server (or SENDER_HMAC_KEY); not reading messages');
        } else if (watched.length > 0 || outbox.media.pendingItemPksWithoutPath().length > 0) {
          try {
            await this.collect(watched, key);
          } catch (err) {
            errors.push(describeError(err, this.opts.waDbPath));
          }
        }
      }

      if (!config?.paused) {
        let flushed = false;
        try {
          await this.flush();
          flushed = true;
        } catch (err) {
          errors.push(`upload: ${describeError(err, this.opts.waDbPath)}`);
        }
        if (flushed) {
          const media = await this.media.run();
          if (media.error) mediaError = `media: ${media.error}`;
        }
      }
    } finally {
      const now = this.now();
      this.state.syncing = false;
      this.state.lastAttemptAt = now.toISOString();
      if (errors.length === 0) this.state.lastSyncAt = now.toISOString();
      const shown = mediaError ? [...errors, mediaError] : errors;
      this.state.error = shown.length > 0 ? shown.join('; ') : null;
      this.state.outboxSize = outbox.size();
      this.state.mediaWaiting = outbox.media.waitingCount();
      this.state.sentToday = outbox.sentOn(localDay(now));
      this.emit();
    }
    return this.status;
  }

  /**
   * Snapshot → schema guard → read → outbox, and re-read ZMEDIALOCALPATH for media whose file
   * WhatsApp had not downloaded yet. The snapshot is always deleted.
   */
  private async collect(watched: string[], senderHmacKey: string): Promise<void> {
    const { outbox } = this.opts;
    const snapshot = await createSnapshot(this.opts.waDbPath, this.opts.workDir);
    let reader: WhatsAppReader | undefined;
    try {
      reader = WhatsAppReader.open(snapshot.dbPath, {
        senderHmacKey,
        ...(this.opts.selfJid ? { selfJid: this.opts.selfJid } : {}),
      });
      const schema = checkSchema(reader.database);
      this.state.schemaOk = schema.ok;
      this.state.schemaFingerprint = schema.fingerprint;
      this.state.missingColumns = schema.missing;
      if (!schema.ok) {
        throw new Error(`WhatsApp schema mismatch; missing ${schema.missing.join(', ')}`);
      }
      const paths = reader.mediaLocalPaths(outbox.media.pendingItemPksWithoutPath());
      outbox.media.updatePendingPaths(paths, this.now());
      if (watched.length > 0) {
        const read = reader.newMessages(
          watched,
          outbox.checkpoints(),
          this.opts.readLimit ?? DEFAULT_READ_LIMIT,
        );
        outbox.enqueue(read.messages, read.checkpoints, this.now());
      }
    } finally {
      reader?.close();
      await snapshot.cleanup();
    }
  }

  /** Upload the outbox in batches of ≤500 until it is empty or a batch makes no progress. */
  async flush(): Promise<void> {
    const { api, outbox } = this.opts;
    for (;;) {
      const batch = outbox.nextBatch();
      if (batch.length === 0) return;

      const res = await api.ingestMessages(batch.map((item) => item.message));
      const key = (groupJid: string, stanzaId: string) => `${groupJid}\u0000${stanzaId}`;
      const results = new Map(res.results.map((r) => [key(r.group_jid, r.stanza_id), r]));

      const sent: number[] = [];
      const rejected: { id: number; error: string | null }[] = [];
      for (const item of batch) {
        const r = results.get(key(item.message.group_jid, item.message.stanza_id));
        if (!r) continue; // not acknowledged: keep it queued
        if (r.status === 'rejected') rejected.push({ id: item.id, error: r.error ?? null });
        else sent.push(item.id);
      }
      const now = this.now();
      outbox.markSent(sent, now);
      outbox.markRejected(rejected, now);
      this.state.outboxSize = outbox.size();
      this.state.sentToday = outbox.sentOn(localDay(now));

      if (sent.length + rejected.length === 0) {
        throw new Error(`server acknowledged none of ${batch.length} messages`);
      }
    }
  }

  /** Send the full group list (from a fresh snapshot) so the web app can pick watched groups. */
  async publishCatalog(): Promise<GroupCatalogResponse> {
    const snapshot: Snapshot = await createSnapshot(this.opts.waDbPath, this.opts.workDir);
    let groups;
    try {
      const reader = WhatsAppReader.open(snapshot.dbPath);
      try {
        groups = reader.groups();
      } finally {
        reader.close();
      }
    } finally {
      await snapshot.cleanup();
    }
    return this.opts.api.postGroupCatalog(groups);
  }

  async sendHeartbeat(): Promise<void> {
    await this.opts.api.heartbeat({
      app_version: this.opts.appVersion,
      schema_fingerprint: this.state.schemaFingerprint ?? '',
      schema_ok: this.state.schemaOk ?? false,
      outbox_size: this.opts.outbox.size(),
      last_sync_at: this.state.lastSyncAt,
    });
  }
}
