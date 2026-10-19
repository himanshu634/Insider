import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildFixtureDb,
  execOnFixture,
  G1,
  G2,
  G3,
  makeTempDir,
  removeTempDirs,
  TEST_HMAC_KEY,
} from '../test-support/fixture.js';
import { ApiError, type CollectorApi } from './api-client.js';
import { Outbox } from './outbox.js';
import { hashSender } from './sender-hash.js';
import { SyncEngine, type SyncEngineOptions } from './sync-engine.js';
import type {
  CatalogGroup,
  DeviceConfig,
  GroupCatalogResponse,
  HeartbeatRequest,
  IngestMessage,
  IngestMessagesResponse,
  MediaUploadUrlRequest,
  MediaUploadUrlResponse,
} from './types.js';

/** In-memory stand-in for the API. No network. */
class FakeApi implements CollectorApi {
  config: DeviceConfig = {
    watched_group_jids: [G1, G2],
    sync_interval_seconds: 90,
    paused: false,
    sender_hmac_key: TEST_HMAC_KEY,
  };
  mediaRequests: MediaUploadUrlRequest[] = [];
  completed: number[] = [];
  batches: IngestMessage[][] = [];
  heartbeats: HeartbeatRequest[] = [];
  catalogs: CatalogGroup[][] = [];
  failIngest = false;
  failConfig = false;
  rejectStanzas = new Set<string>();
  seen = new Set<string>();

  async getDeviceConfig(): Promise<DeviceConfig> {
    if (this.failConfig) throw new ApiError('offline', 0, true);
    return structuredClone(this.config);
  }

  async ingestMessages(messages: IngestMessage[]): Promise<IngestMessagesResponse> {
    if (this.failIngest) throw new ApiError('POST /v1/ingest/messages → 503', 503, true);
    this.batches.push(messages);
    const results = messages.map((m) => {
      const key = `${m.group_jid}/${m.stanza_id}`;
      const status = this.rejectStanzas.has(m.stanza_id)
        ? ('rejected' as const)
        : this.seen.has(key)
          ? ('duplicate' as const)
          : ('accepted' as const);
      this.seen.add(key);
      return { group_jid: m.group_jid, stanza_id: m.stanza_id, status, error: status === 'rejected' ? 'bad' : null };
    });
    const count = (s: string) => results.filter((r) => r.status === s).length;
    return { accepted: count('accepted'), duplicate: count('duplicate'), rejected: count('rejected'), results };
  }

  async heartbeat(body: HeartbeatRequest): Promise<void> {
    this.heartbeats.push(body);
  }

  async postGroupCatalog(groups: CatalogGroup[]): Promise<GroupCatalogResponse> {
    this.catalogs.push(groups);
    return { received: groups.length, created: groups.length };
  }

  async createMediaUploadUrl(req: MediaUploadUrlRequest): Promise<MediaUploadUrlResponse> {
    if (!this.seen.has(`${req.group_jid}/${req.stanza_id}`)) {
      throw new ApiError('POST /v1/ingest/media/upload-url → 404', 404, false);
    }
    this.mediaRequests.push(req);
    return {
      media_id: this.mediaRequests.length,
      upload_url: 'https://storage.example.test/bucket/obj?X-Goog-Signature=abc',
      gcs_path: 'wa/x.jpeg',
      expires_at: '2026-10-19T07:00:00.000Z',
      already_uploaded: false,
    };
  }

  async completeMediaUpload(mediaId: number): Promise<void> {
    this.completed.push(mediaId);
  }

  get uploaded(): IngestMessage[] {
    return this.batches.flat();
  }
}

let api: FakeApi;
let outbox: Outbox;
let dbPath: string;
let workDir: string;
let clock: Date;
let puts: { url: string; body: Uint8Array; mime: string }[];

function engine(overrides: Partial<SyncEngineOptions> = {}): SyncEngine {
  return new SyncEngine({
    waDbPath: dbPath,
    senderHmacKey: TEST_HMAC_KEY,
    api,
    outbox,
    workDir,
    appVersion: '0.1.0-test',
    now: () => clock,
    putFile: async (url, body, mime) => {
      puts.push({ url, body, mime });
    },
    ...overrides,
  });
}

beforeEach(() => {
  api = new FakeApi();
  clock = new Date(2026, 9, 19, 12, 0, 0);
  puts = [];
  const dir = makeTempDir();
  dbPath = buildFixtureDb(dir);
  workDir = join(dir, 'snapshots');
  outbox = Outbox.open(join(dir, 'outbox.sqlite'));
});

afterEach(() => outbox.close());
afterAll(removeTempDirs);

const G1_COUNT = 7;
const G2_COUNT = 7;

describe('SyncEngine.tick', () => {
  it('uploads every message of the watched groups and cleans up the snapshot', async () => {
    const status = await engine().tick();
    expect(api.uploaded).toHaveLength(G1_COUNT + G2_COUNT);
    expect(new Set(api.uploaded.map((m) => m.group_jid))).toEqual(new Set([G1, G2]));
    expect(status).toMatchObject({
      error: null,
      schemaOk: true,
      outboxSize: 0,
      sentToday: G1_COUNT + G2_COUNT,
      watchedGroups: 2,
      syncing: false,
    });
    expect(status.lastSyncAt).not.toBeNull();
    expect(status.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(readdirSync(workDir)).toEqual([]);
    expect(outbox.checkpoints()).toEqual(new Map([[G1, 19], [G2, 20]]));
  });

  it('only uploads new messages on later ticks', async () => {
    const e = engine();
    await e.tick();
    await e.tick();
    expect(api.uploaded).toHaveLength(G1_COUNT + G2_COUNT);

    execOnFixture(
      dbPath,
      `INSERT INTO ZWAMESSAGE (Z_PK, ZISFROMME, ZMESSAGETYPE, ZFLAGS, ZCHATSESSION, ZGROUPMEMBER, ZMESSAGEDATE, ZSTANZAID, ZTEXT)
       VALUES (21, 0, 0, 0, 1, 2, 814076000, 'SYNTH-G1-0008', 'એરંડા 1265-1295 ગોંડલ');`,
    );
    const status = await e.tick();
    expect(api.batches.at(-1)?.map((m) => m.stanza_id)).toEqual(['SYNTH-G1-0008']);
    expect(status.sentToday).toBe(G1_COUNT + G2_COUNT + 1);
  });

  it('keeps messages in the outbox while the API is down and sends them later, once', async () => {
    api.failIngest = true;
    const e = engine();
    const down = await e.tick();
    expect(down.error).toMatch(/upload/);
    expect(down.outboxSize).toBe(G1_COUNT + G2_COUNT);
    expect(down.lastSyncAt).toBeNull();

    api.failIngest = false;
    const up = await e.tick();
    expect(up.error).toBeNull();
    expect(up.outboxSize).toBe(0);
    const keys = api.uploaded.map((m) => `${m.group_jid}/${m.stanza_id}`);
    expect(keys).toHaveLength(G1_COUNT + G2_COUNT);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps collecting with the last known config when the config call fails', async () => {
    const e = engine();
    await e.tick();
    api.failConfig = true;
    execOnFixture(
      dbPath,
      `INSERT INTO ZWAMESSAGE (Z_PK, ZISFROMME, ZMESSAGETYPE, ZFLAGS, ZCHATSESSION, ZGROUPMEMBER, ZMESSAGEDATE, ZSTANZAID, ZTEXT)
       VALUES (21, 0, 0, 0, 2, 4, 814076000, 'SYNTH-G2-0008', 'sing 1200');`,
    );
    const status = await e.tick();
    expect(status.error).toBeNull();
    expect(api.batches.at(-1)?.map((m) => m.stanza_id)).toEqual(['SYNTH-G2-0008']);
  });

  it('reports an error and reads nothing without any config', async () => {
    api.failConfig = true;
    const status = await engine().tick();
    expect(status.error).toMatch(/device config/);
    expect(api.uploaded).toHaveLength(0);
  });

  it('stops reading on a schema mismatch', async () => {
    execOnFixture(dbPath, 'ALTER TABLE ZWAMESSAGE DROP COLUMN ZFLAGS;');
    const status = await engine().tick();
    expect(status.schemaOk).toBe(false);
    expect(status.missingColumns).toEqual(['ZWAMESSAGE.ZFLAGS']);
    expect(status.error).toMatch(/schema mismatch/);
    expect(api.uploaded).toHaveLength(0);
    expect(outbox.checkpoints().size).toBe(0);
    expect(readdirSync(workDir)).toEqual([]);
  });

  it('does nothing while the server has paused the device', async () => {
    api.config.paused = true;
    const status = await engine().tick();
    expect(status.serverPaused).toBe(true);
    expect(status.error).toBeNull();
    expect(api.uploaded).toHaveLength(0);
    expect(outbox.size()).toBe(0);
  });

  it('ignores non-group JIDs in the watch list', async () => {
    api.config.watched_group_jids = [G3, '910000000999@s.whatsapp.net'];
    const status = await engine().tick();
    expect(status.watchedGroups).toBe(1);
    expect(new Set(api.uploaded.map((m) => m.group_jid))).toEqual(new Set([G3]));
  });

  it('drops rejected messages instead of retrying them', async () => {
    api.rejectStanzas.add('SYNTH-G1-0002');
    const e = engine();
    const status = await e.tick();
    expect(status.outboxSize).toBe(0);
    expect(status.sentToday).toBe(G1_COUNT + G2_COUNT - 1);
    expect(outbox.rejectedCount()).toBe(1);
    await e.tick();
    expect(api.uploaded.filter((m) => m.stanza_id === 'SYNTH-G1-0002')).toHaveLength(1);
  });

  it('uploads in batches of at most 500', async () => {
    const rows = Array.from({ length: 1100 }, (_, i) => {
      const pk = 100 + i;
      return `(${pk}, 0, 0, 0, 1, 1, ${814080000 + i}, 'SYNTH-BULK-${pk}', 'bulk ${i}')`;
    }).join(',\n');
    execOnFixture(
      dbPath,
      `INSERT INTO ZWAMESSAGE (Z_PK, ZISFROMME, ZMESSAGETYPE, ZFLAGS, ZCHATSESSION, ZGROUPMEMBER, ZMESSAGEDATE, ZSTANZAID, ZTEXT) VALUES ${rows};`,
    );
    await engine().tick();
    expect(api.batches.map((b) => b.length)).toEqual([500, 500, 114]);
  });

  it('hashes senders with the key from the server when there is no env key', async () => {
    api.config.sender_hmac_key = 'server-key';
    const status = await engine({ senderHmacKey: undefined }).tick();
    expect(status.error).toBeNull();
    expect(api.uploaded).toHaveLength(G1_COUNT + G2_COUNT);
    const fromG1 = api.uploaded.find((m) => m.stanza_id === 'SYNTH-G1-0002');
    expect(fromG1?.sender_hash).toBe(hashSender('910000000102@s.whatsapp.net', 'server-key'));
  });

  it('prefers the server key over SENDER_HMAC_KEY', async () => {
    api.config.sender_hmac_key = 'server-key';
    await engine({ senderHmacKey: 'env-key' }).tick();
    const fromG1 = api.uploaded.find((m) => m.stanza_id === 'SYNTH-G1-0002');
    expect(fromG1?.sender_hash).toBe(hashSender('910000000102@s.whatsapp.net', 'server-key'));
  });

  it('falls back to SENDER_HMAC_KEY when the server sends no key', async () => {
    api.config.sender_hmac_key = '';
    await engine({ senderHmacKey: 'env-key' }).tick();
    const fromG1 = api.uploaded.find((m) => m.stanza_id === 'SYNTH-G1-0002');
    expect(fromG1?.sender_hash).toBe(hashSender('910000000102@s.whatsapp.net', 'env-key'));
  });

  it('refuses to read without any sender HMAC key', async () => {
    api.config.sender_hmac_key = '';
    const status = await engine({ senderHmacKey: undefined }).tick();
    expect(status.error).toMatch(/sender HMAC key/);
    expect(api.uploaded).toHaveLength(0);
  });

  it('reports a missing WhatsApp database', async () => {
    const status = await engine({ waDbPath: join(makeTempDir(), 'nope.sqlite') }).tick();
    expect(status.error).toMatch(/not found/);
  });

  it('never runs two ticks at once', async () => {
    const e = engine();
    const [a, b] = [e.tick(), e.tick()];
    expect(a).toBe(b);
    await a;
    expect(api.uploaded).toHaveLength(G1_COUNT + G2_COUNT);
  });

  it('reports status changes', async () => {
    const seen: boolean[] = [];
    await engine({ onStatus: (s) => seen.push(s.syncing) }).tick();
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
  });
});

describe('SyncEngine catalog and heartbeat', () => {
  it('publishes the group catalog without 1:1 chats', async () => {
    const res = await engine().publishCatalog();
    expect(res.received).toBe(3);
    expect(api.catalogs[0]?.map((g) => g.jid).sort()).toEqual([G1, G2, G3]);
    expect(readdirSync(workDir)).toEqual([]);
  });

  it('sends a heartbeat with schema and outbox state', async () => {
    const e = engine();
    await e.tick();
    await e.sendHeartbeat();
    expect(api.heartbeats[0]).toMatchObject({
      app_version: '0.1.0-test',
      schema_ok: true,
      outbox_size: 0,
    });
    expect(api.heartbeats[0]?.schema_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(api.heartbeats[0]?.last_sync_at).toBe(e.status.lastSyncAt);
  });
});

describe('SyncEngine media', () => {
  const IMAGE_STANZA = 'SYNTH-G2-0003';
  const IMAGE_PATH = 'Media/120363000000000002@g.us/0/a/SYNTH-0001.jpg';

  function writeMediaFile(relPath: string, bytes: Buffer): void {
    const file = join(dirname(dbPath), 'Message', relPath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }

  it('uploads an image once WhatsApp has the file, after its message', async () => {
    const bytes = Buffer.from('synthetic jpeg bytes');
    writeMediaFile(IMAGE_PATH, bytes);
    const status = await engine().tick();
    expect(status.error).toBeNull();
    expect(api.mediaRequests).toEqual([
      {
        group_jid: G2,
        stanza_id: IMAGE_STANZA,
        mime: 'image/jpeg',
        size_bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ]);
    expect(puts).toHaveLength(1);
    expect(Buffer.from(puts[0]!.body).equals(bytes)).toBe(true);
    expect(puts[0]?.mime).toBe('image/jpeg');
    expect(api.completed).toEqual([1]);
    expect(status.mediaWaiting).toBe(0);
  });

  it('keeps a media message whose file is not downloaded yet and uploads it when it appears', async () => {
    execOnFixture(dbPath, 'UPDATE ZWAMEDIAITEM SET ZMEDIALOCALPATH = NULL WHERE Z_PK = 1;');
    const e = engine();
    const first = await e.tick();
    expect(first.error).toBeNull();
    expect(api.uploaded.some((m) => m.stanza_id === IMAGE_STANZA)).toBe(true);
    expect(outbox.checkpoints().get(G2)).toBe(20); // the checkpoint moved past the image
    expect(first.mediaWaiting).toBe(1);
    expect(api.mediaRequests).toHaveLength(0);

    // Still nothing on the next tick.
    expect((await e.tick()).mediaWaiting).toBe(1);

    // WhatsApp finishes the download.
    execOnFixture(dbPath, `UPDATE ZWAMEDIAITEM SET ZMEDIALOCALPATH = '${IMAGE_PATH}' WHERE Z_PK = 1;`);
    writeMediaFile(IMAGE_PATH, Buffer.from('late jpeg'));
    const later = await e.tick();
    expect(later.error).toBeNull();
    expect(later.mediaWaiting).toBe(0);
    expect(api.mediaRequests.map((r) => r.stanza_id)).toEqual([IMAGE_STANZA]);
    expect(api.completed).toEqual([1]);
    expect(readdirSync(workDir)).toEqual([]);
  });

  it('re-checks pending media even when no group is watched any more', async () => {
    execOnFixture(dbPath, 'UPDATE ZWAMEDIAITEM SET ZMEDIALOCALPATH = NULL WHERE Z_PK = 1;');
    const e = engine();
    await e.tick();
    api.config.watched_group_jids = [];
    execOnFixture(dbPath, `UPDATE ZWAMEDIAITEM SET ZMEDIALOCALPATH = '${IMAGE_PATH}' WHERE Z_PK = 1;`);
    writeMediaFile(IMAGE_PATH, Buffer.from('jpeg'));
    const status = await e.tick();
    expect(status.mediaWaiting).toBe(0);
    expect(api.completed).toHaveLength(1);
  });

  it('gives up on a file that never downloads after 7 days and records it', async () => {
    execOnFixture(dbPath, 'UPDATE ZWAMEDIAITEM SET ZMEDIALOCALPATH = NULL WHERE Z_PK = 1;');
    const e = engine();
    await e.tick();
    clock = new Date(clock.getTime() + 7 * 24 * 60 * 60 * 1000 - 1000);
    expect((await e.tick()).mediaWaiting).toBe(1);
    clock = new Date(clock.getTime() + 1000);
    const status = await e.tick();
    expect(status.mediaWaiting).toBe(0);
    expect(status.error).toBeNull();
    expect(outbox.media.failed()).toEqual([
      expect.objectContaining({ groupJid: G2, stanzaId: IMAGE_STANZA, reason: expect.stringMatching(/7 days/) }),
    ]);
  });

  it('gives up the media of a rejected message', async () => {
    writeMediaFile(IMAGE_PATH, Buffer.from('jpeg'));
    api.rejectStanzas.add(IMAGE_STANZA);
    const status = await engine().tick();
    expect(status.mediaWaiting).toBe(0);
    expect(api.mediaRequests).toHaveLength(0);
    expect(outbox.media.failed()[0]).toMatchObject({ stanzaId: IMAGE_STANZA, reason: 'message rejected' });
  });

  it('does not upload media while the messages cannot be uploaded', async () => {
    writeMediaFile(IMAGE_PATH, Buffer.from('jpeg'));
    api.failIngest = true;
    const e = engine();
    const down = await e.tick();
    expect(down.mediaWaiting).toBe(1);
    expect(api.mediaRequests).toHaveLength(0);
    api.failIngest = false;
    expect((await e.tick()).mediaWaiting).toBe(0);
    expect(api.completed).toHaveLength(1);
  });
});
