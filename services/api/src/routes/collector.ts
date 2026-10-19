/** Endpoints the macOS collector calls, authenticated by its device token. */
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Schemas } from '../contract.js';
import type { Db } from '../db/client.js';
import { collectorDevice, waGroup, waMedia, waMessage } from '../db/schema.js';
import type { AppEnv } from '../env.js';
import { body, notFound } from '../http.js';
import { mediaPath, signedUploadUrl } from '../media.js';
import { contentHash } from '../pipeline/normalize-text.js';

export const collector = new Hono<AppEnv>();

/** Map JIDs to group ids, creating placeholder groups for any not yet in the catalog. */
async function ensureGroups(db: Db, jids: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(jids)];
  await db
    .insert(waGroup)
    .values(unique.map((jid) => ({ jid, name: jid })))
    .onConflictDoNothing({ target: waGroup.jid });
  const rows = await db
    .select({ jid: waGroup.jid, id: waGroup.id })
    .from(waGroup)
    .where(inArray(waGroup.jid, unique));
  return new Map(rows.map((r) => [r.jid, r.id]));
}

collector.post('/v1/ingest/messages', body('IngestMessagesRequest'), async (c) => {
  const { messages } = c.req.valid('json');
  const { db, queue } = c.var;
  const groupIds = await ensureGroups(
    db,
    messages.map((m) => m.group_jid),
  );

  const inserted = await db
    .insert(waMessage)
    .values(
      messages.map((m) => ({
        groupId: groupIds.get(m.group_jid)!,
        deviceId: c.var.device.id,
        stanzaId: m.stanza_id,
        senderHash: m.sender_hash,
        senderName: m.sender_name ?? null,
        sentAt: new Date(m.sent_at),
        type: m.type,
        text: m.text ?? null,
        quotedStanzaId: m.quoted_stanza_id ?? null,
        isForwarded: m.is_forwarded,
        contentHash: contentHash(m.text),
      })),
    )
    .onConflictDoNothing({ target: [waMessage.groupId, waMessage.stanzaId] })
    .returning({ id: waMessage.id, groupId: waMessage.groupId, stanzaId: waMessage.stanzaId });

  const accepted = new Set(inserted.map((r) => `${r.groupId}:${r.stanzaId}`));
  for (const row of inserted) await queue.enqueue('process-message', { messageId: row.id });

  const results: Schemas['IngestItemResult'][] = messages.map((m) => ({
    group_jid: m.group_jid,
    stanza_id: m.stanza_id,
    status: accepted.has(`${groupIds.get(m.group_jid)}:${m.stanza_id}`) ? 'accepted' : 'duplicate',
  }));
  return c.json({
    accepted: inserted.length,
    duplicate: messages.length - inserted.length,
    rejected: 0,
    results,
  } satisfies Schemas['IngestMessagesResponse']);
});

collector.post('/v1/ingest/media/upload-url', body('MediaUploadUrlRequest'), async (c) => {
  const req = c.req.valid('json');
  const { db, config } = c.var;
  const [message] = await db
    .select({ id: waMessage.id })
    .from(waMessage)
    .innerJoin(waGroup, eq(waMessage.groupId, waGroup.id))
    .where(and(eq(waGroup.jid, req.group_jid), eq(waMessage.stanzaId, req.stanza_id)));
  if (!message) throw notFound('Upload the message before its media');

  const [existing] = await db
    .select({ gcsPath: waMedia.gcsPath })
    .from(waMedia)
    .where(and(eq(waMedia.sha256, req.sha256), eq(waMedia.uploaded, true)))
    .limit(1);
  const gcsPath = existing?.gcsPath ?? mediaPath(req.group_jid, req.stanza_id, req.sha256, req.mime);
  const [media] = await db
    .insert(waMedia)
    .values({
      messageId: message.id,
      gcsPath,
      mime: req.mime,
      sizeBytes: req.size_bytes,
      sha256: req.sha256,
      uploaded: existing !== undefined,
    })
    .returning({ id: waMedia.id });

  const { url, expiresAt } = await signedUploadUrl(config, gcsPath, req.mime);
  return c.json({
    media_id: media!.id,
    upload_url: url,
    gcs_path: gcsPath,
    expires_at: expiresAt.toISOString(),
    already_uploaded: existing !== undefined,
  } satisfies Schemas['MediaUploadUrlResponse']);
});

collector.post('/v1/ingest/media/complete', body('MediaCompleteRequest'), async (c) => {
  const { media_id } = c.req.valid('json');
  const [media] = await c.var.db
    .update(waMedia)
    .set({ uploaded: true })
    .where(eq(waMedia.id, media_id))
    .returning({ id: waMedia.id });
  if (!media) throw notFound('Unknown media id');
  await c.var.queue.enqueue('ocr-media', { mediaId: media.id });
  return c.json({ status: 'queued' } satisfies Schemas['StatusResponse'], 202);
});

collector.post('/v1/groups/catalog', body('GroupCatalogRequest'), async (c) => {
  const { groups } = c.req.valid('json');
  const { db } = c.var;
  if (groups.length === 0) return c.json({ received: 0, created: 0 });

  const before = await db
    .select({ jid: waGroup.jid })
    .from(waGroup)
    .where(
      inArray(
        waGroup.jid,
        groups.map((g) => g.jid),
      ),
    );
  const known = new Set(before.map((r) => r.jid));
  for (const g of groups) {
    await db
      .insert(waGroup)
      .values({ jid: g.jid, name: g.name, memberCount: g.member_count ?? null })
      .onConflictDoUpdate({
        target: waGroup.jid,
        set: { name: g.name, memberCount: g.member_count ?? null },
      });
  }
  return c.json({
    received: groups.length,
    created: groups.filter((g) => !known.has(g.jid)).length,
  } satisfies Schemas['GroupCatalogResponse']);
});

collector.get('/v1/devices/config', async (c) => {
  const watched = await c.var.db
    .select({ jid: waGroup.jid })
    .from(waGroup)
    .where(eq(waGroup.isWatched, true));
  return c.json({
    watched_group_jids: watched.map((w) => w.jid),
    sync_interval_seconds: c.var.config.defaultSyncIntervalSeconds,
    paused: c.var.device.paused,
  } satisfies Schemas['DeviceConfig']);
});

collector.post('/v1/devices/heartbeat', body('HeartbeatRequest'), async (c) => {
  const hb = c.req.valid('json');
  const device = c.var.device;
  const status =
    device.status === 'revoked'
      ? 'revoked'
      : !hb.schema_ok
        ? 'schema_mismatch'
        : device.paused
          ? 'paused'
          : 'active';
  await c.var.db
    .update(collectorDevice)
    .set({
      appVersion: hb.app_version,
      schemaFingerprint: hb.schema_fingerprint,
      schemaOk: hb.schema_ok,
      outboxSize: hb.outbox_size,
      lastSyncAt: hb.last_sync_at ? new Date(hb.last_sync_at) : null,
      lastHeartbeatAt: new Date(),
      status,
    })
    .where(eq(collectorDevice.id, device.id));
  return c.body(null, 204);
});
