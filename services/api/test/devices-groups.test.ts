import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { collectorDevice } from '../src/db/schema.js';
import { collectorWatchdog } from '../src/pipeline/tasks.js';
import { setup } from './helpers.js';

const GROUP = '120363000000000009@g.us';

describe('collector config, catalog and heartbeat', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => (t = await setup()));
  afterEach(() => t.close());

  it('watching a group puts it in the device config', async () => {
    const catalog = await t.request('/v1/groups/catalog', {
      method: 'POST',
      json: { groups: [{ jid: GROUP, name: 'Gondal Castor Rates', member_count: 212 }] },
    });
    expect(await catalog.json()).toEqual({ received: 1, created: 1 });

    let config = await (await t.request('/v1/devices/config')).json();
    expect(config.watched_group_jids).toEqual([]);

    const [group] = await (await t.request('/v1/groups', { device: false })).json();
    const patched = await t.request('/v1/groups', { method: 'PATCH', device: false, json: { id: group.id, is_watched: true } });
    expect((await patched.json()).is_watched).toBe(true);

    config = await (await t.request('/v1/devices/config')).json();
    expect(config).toEqual({
      watched_group_jids: [GROUP],
      sync_interval_seconds: 90,
      paused: false,
      sender_hmac_key: loadConfig().senderHmacKey,
    });
  });

  it('device config hands the sender HMAC key to the device, and only with a device token', async () => {
    const config = await (await t.request('/v1/devices/config')).json();
    expect(config.sender_hmac_key).toBe(loadConfig().senderHmacKey);
    expect(config.sender_hmac_key.length).toBeGreaterThan(0);
    expect((await t.request('/v1/devices/config', { device: false })).status).toBe(401);
  });

  it('heartbeat with a schema mismatch flags the device', async () => {
    const res = await t.request('/v1/devices/heartbeat', {
      method: 'POST',
      json: { app_version: '0.1.0', schema_fingerprint: 'abc', schema_ok: false, outbox_size: 3 },
    });
    expect(res.status).toBe(204);
    const [device] = await (await t.request('/v1/devices', { device: false })).json();
    expect(device).toMatchObject({ status: 'schema_mismatch', outbox_size: 3 });
  });

  it('watchdog marks devices silent after 30 minutes', async () => {
    await t.db.update(collectorDevice).set({ lastHeartbeatAt: new Date(Date.now() - 45 * 60_000) });
    expect(await collectorWatchdog(t.db)).toHaveLength(1);
    const [device] = await t.db.select().from(collectorDevice).where(eq(collectorDevice.name, 'test-mac'));
    expect(device!.status).toBe('silent');
  });
});
