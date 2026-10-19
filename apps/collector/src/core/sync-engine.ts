import type { CollectorApi } from './api-client.js';
import { isPermissionError } from './disk-access.js';
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
  senderHmacKey: string | undefined;
  api: CollectorApi;
  outbox: Outbox;
  /** Where snapshots are copied (and deleted again). */
  workDir: string;
  appVersion: string;
  /** Max WhatsApp rows read per tick; the rest follow on the next tick. */
  readLimit?: number;
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
 * One tick: device config → snapshot → schema guard → read new messages of watched groups →
 * outbox (+ checkpoints, one transaction) → upload in batches → delete the snapshot.
 * Ticks never overlap; calling tick() while one runs returns the running tick.
 */
export class SyncEngine {
  private running: Promise<SyncStatus> | null = null;
  private deviceConfig: DeviceConfig | null = null;
  private readonly now: () => Date;
  private readonly state: SyncStatus;

  constructor(private readonly opts: SyncEngineOptions) {
    this.now = opts.now ?? (() => new Date());
    this.state = {
      lastSyncAt: null,
      lastAttemptAt: null,
      sentToday: opts.outbox.sentOn(localDay(this.now())),
      outboxSize: opts.outbox.size(),
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

  private emit(): void {
    this.opts.onStatus?.(this.status);
  }

  private async runTick(): Promise<SyncStatus> {
    const { api, outbox } = this.opts;
    const errors: string[] = [];
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
        if (!this.opts.senderHmacKey) {
          errors.push('SENDER_HMAC_KEY is not set; not reading messages');
        } else if (watched.length > 0) {
          try {
            await this.collect(watched, this.opts.senderHmacKey);
          } catch (err) {
            errors.push(describeError(err, this.opts.waDbPath));
          }
        }
      }

      if (!config?.paused) {
        try {
          await this.flush();
        } catch (err) {
          errors.push(`upload: ${describeError(err, this.opts.waDbPath)}`);
        }
      }
    } finally {
      const now = this.now();
      this.state.syncing = false;
      this.state.lastAttemptAt = now.toISOString();
      if (errors.length === 0) this.state.lastSyncAt = now.toISOString();
      this.state.error = errors.length > 0 ? errors.join('; ') : null;
      this.state.outboxSize = outbox.size();
      this.state.sentToday = outbox.sentOn(localDay(now));
      this.emit();
    }
    return this.status;
  }

  /** Snapshot → schema guard → read → outbox. The snapshot is always deleted. */
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
      const read = reader.newMessages(
        watched,
        outbox.checkpoints(),
        this.opts.readLimit ?? DEFAULT_READ_LIMIT,
      );
      outbox.enqueue(read.messages, read.checkpoints, this.now());
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
