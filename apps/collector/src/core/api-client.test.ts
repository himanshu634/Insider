import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, signedUrlPut } from './api-client.js';
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

describe('media endpoints', () => {
  it('asks for an upload URL and completes with the device token', async () => {
    const res = { media_id: 7, upload_url: 'https://gcs.test/x?sig=1', gcs_path: 'wa/x', expires_at: '2026-10-19T07:00:00Z', already_uploaded: false };
    const { c, calls } = client([json(res), json({ status: 'queued' }, 202)]);
    const req = { group_jid: '1@g.us', stanza_id: 's1', mime: 'image/jpeg', size_bytes: 3, sha256: 'a'.repeat(64) };
    expect(await c.createMediaUploadUrl(req)).toEqual(res);
    await c.completeMediaUpload(7);
    expect(calls.map((x) => [x.init.method, x.url])).toEqual([
      ['POST', 'http://api.test/v1/ingest/media/upload-url'],
      ['POST', 'http://api.test/v1/ingest/media/complete'],
    ]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(req);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ media_id: 7 });
    expect(new Headers(calls[1]?.init.headers).get('authorization')).toBe('Bearer tok');
  });
});

describe('signedUrlPut', () => {
  it('PUTs the bytes with the signed Content-Type and no Authorization header', async () => {
    const f = fakeFetch([new Response(null, { status: 200 })]);
    const body = new Uint8Array([1, 2, 3]);
    await signedUrlPut({ fetch: f.fn })('https://gcs.test/x?sig=1', body, 'application/pdf');
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0]!;
    expect(url).toBe('https://gcs.test/x?sig=1');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(body);
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/pdf');
    expect(headers.has('authorization')).toBe(false);
  });

  it('throws ApiError without the signed URL in the message', async () => {
    const put = signedUrlPut({ fetch: fakeFetch([new Response('SignatureDoesNotMatch', { status: 403 })]).fn });
    const err = await put('https://gcs.test/x?sig=secret', new Uint8Array(), 'image/jpeg').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, retryable: false });
    expect((err as Error).message).not.toContain('secret');

    const net = signedUrlPut({ fetch: fakeFetch([new Error('ECONNRESET')]).fn });
    await expect(net('https://gcs.test/x', new Uint8Array(), 'image/jpeg')).rejects.toMatchObject({ status: 0, retryable: true });
  });
});
