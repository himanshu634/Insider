import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from './api-client.js';
import type { IngestMessage } from './types.js';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(responses: (Response | Error)[], retries = 3) {
  const f = fakeFetch(responses);
  const sleeps: number[] = [];
  const c = new ApiClient({
    baseUrl: 'http://api.test/',
    deviceToken: 'tok',
    retries,
    baseDelayMs: 100,
    fetch: f.fn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 1,
  });
  return { c, calls: f.calls, sleeps };
}

const message: IngestMessage = {
  stanza_id: 's1',
  group_jid: '120363000000000001@g.us',
  sender_hash: 'a'.repeat(64),
  sent_at: '2026-10-19T03:30:00.000Z',
  type: 'text',
  is_forwarded: false,
};

describe('ApiClient', () => {
  it('sends the bearer token and JSON body', async () => {
    const res = { accepted: 1, duplicate: 0, rejected: 0, results: [] };
    const { c, calls } = client([json(res)]);
    expect(await c.ingestMessages([message])).toEqual(res);
    expect(calls[0]?.url).toBe('http://api.test/v1/ingest/messages');
    expect(calls[0]?.init.method).toBe('POST');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ messages: [message] });
  });

  it('handles 204 from the heartbeat', async () => {
    const { c } = client([new Response(null, { status: 204 })]);
    await expect(
      c.heartbeat({ app_version: '1', schema_fingerprint: 'x', schema_ok: true, outbox_size: 0 }),
    ).resolves.toBeUndefined();
  });

  it('GETs the device config and POSTs the catalog', async () => {
    const cfg = { watched_group_jids: [], sync_interval_seconds: 90, paused: false };
    const { c, calls } = client([json(cfg), json({ received: 0, created: 0 })]);
    expect(await c.getDeviceConfig()).toEqual(cfg);
    expect(calls[0]?.init.method).toBe('GET');
    await c.postGroupCatalog([]);
    expect(calls[1]?.url).toBe('http://api.test/v1/groups/catalog');
  });

  it('retries 5xx and network errors with exponential backoff', async () => {
    const cfg = { watched_group_jids: [], sync_interval_seconds: 90, paused: false };
    const { c, calls, sleeps } = client([
      new Response('down', { status: 503 }),
      new TypeError('fetch failed'),
      json(cfg),
    ]);
    expect(await c.getDeviceConfig()).toEqual(cfg);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('honours Retry-After on 429', async () => {
    const { c, sleeps } = client([
      new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }),
      json({ received: 0, created: 0 }),
    ]);
    await c.postGroupCatalog([]);
    expect(sleeps).toEqual([2000]);
  });

  it('does not retry 401 and exposes the status', async () => {
    const { c, calls } = client([new Response('{"detail":"bad token"}', { status: 401 })]);
    const err = await c.getDeviceConfig().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, retryable: false });
    expect(calls).toHaveLength(1);
  });

  it('gives up after the configured retries', async () => {
    const { c, calls } = client(
      [0, 1, 2].map(() => new Response('x', { status: 500 })),
      2,
    );
    await expect(c.getDeviceConfig()).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(3);
  });

  it('refuses empty or oversized batches and a missing token', async () => {
    const { c } = client([]);
    await expect(c.ingestMessages([])).rejects.toThrow(/1\.\.500/);
    await expect(c.ingestMessages(Array.from({ length: 501 }, () => message))).rejects.toThrow();
    expect(() => new ApiClient({ baseUrl: 'http://x', deviceToken: '' })).toThrow(/token/);
  });
});
