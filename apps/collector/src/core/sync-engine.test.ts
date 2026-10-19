import { readdirSync } from 'node:fs';
import { join } from 'node:path';
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
import { SyncEngine, type SyncEngineOptions } from './sync-engine.js';
import type {
  CatalogGroup,
  DeviceConfig,
  GroupCatalogResponse,
  HeartbeatRequest,
  IngestMessage,
  IngestMessagesResponse,
} from './types.js';

/** In-memory stand-in for the API. No network. */
class FakeApi implements CollectorApi {
  config: DeviceConfig = { watched_group_jids: [G1, G2], sync_interval_seconds: 90, paused: false };
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

  get uploaded(): IngestMessage[] {
    return this.batches.flat();
  }
}

let api: FakeApi;
let outbox: Outbox;
let dbPath: string;
let workDir: string;

function engine(overrides: Partial<SyncEngineOptions> = {}): SyncEngine {
  return new SyncEngine({
    waDbPath: dbPath,
    senderHmacKey: TEST_HMAC_KEY,
    api,
    outbox,
    workDir,
    appVersion: '0.1.0-test',
    now: () => new Date(2026, 9, 19, 12, 0, 0),
    ...overrides,
  });
}

beforeEach(() => {
  api = new FakeApi();
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

  it('refuses to read without SENDER_HMAC_KEY', async () => {
    const status = await engine({ senderHmacKey: undefined }).tick();
    expect(status.error).toMatch(/SENDER_HMAC_KEY/);
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
