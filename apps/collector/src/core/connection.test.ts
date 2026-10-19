import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDirs } from '../test-support/fixture.js';
import { normalizeConnection, readSettings, testConnection, writeSettings } from './connection.js';

afterAll(removeTempDirs);

describe('normalizeConnection', () => {
  it('trims input and drops trailing slashes', () => {
    expect(normalizeConnection({ apiUrl: ' https://insider.example.test/api/ ', deviceToken: ' tok_123 ' })).toEqual({
      ok: true,
      value: { apiUrl: 'https://insider.example.test/api', deviceToken: 'tok_123' },
    });
    expect(normalizeConnection({ apiUrl: 'http://localhost:8000/', deviceToken: 't' })).toEqual({
      ok: true,
      value: { apiUrl: 'http://localhost:8000', deviceToken: 't' },
    });
  });

  it.each([
    ['', 't', /API URL/],
    ['insider.example.test', 't', /API URL/],
    ['http://insider.example.test', 't', /https/],
    ['ftp://insider.example.test', 't', /https/],
    ['https://u:p@insider.example.test', 't', /user name/],
    ['https://insider.example.test/?x=1', 't', /query/],
    ['https://insider.example.test', '  ', /device token/],
    ['https://insider.example.test', 'two words', /device token/],
  ])('rejects %j / %j', (apiUrl, deviceToken, error) => {
    const res = normalizeConnection({ apiUrl, deviceToken });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(error);
  });

  it('rejects non-strings', () => {
    expect(normalizeConnection({ apiUrl: 1, deviceToken: null }).ok).toBe(false);
  });
});

describe('testConnection', () => {
  const conn = { apiUrl: 'https://api.test', deviceToken: 'tok' };
  const config = { watched_group_jids: [], sync_interval_seconds: 90, paused: false, sender_hmac_key: 'k' };

  function fetchOnce(res: Response | Error) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (res instanceof Error) throw res;
      return res;
    }) as typeof fetch;
    return { fn, calls };
  }

  it('fetches the device config once with the new token', async () => {
    const f = fetchOnce(new Response(JSON.stringify(config), { status: 200 }));
    expect(await testConnection(conn, { fetch: f.fn })).toEqual({ ok: true, value: config });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe('https://api.test/v1/devices/config');
    expect(new Headers(f.calls[0]?.init.headers).get('authorization')).toBe('Bearer tok');
  });

  it.each([
    [new Response('no', { status: 401 }), /did not accept/],
    [new Response('no', { status: 404 }), /No Insider API/],
    [new Response('no', { status: 503 }), /503/],
    [new Error('ECONNREFUSED'), /Could not reach https:\/\/api.test/],
  ])('explains failures without retrying (%#)', async (res, error) => {
    const f = fetchOnce(res);
    const out = await testConnection(conn, { fetch: f.fn });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(error);
    expect(f.calls).toHaveLength(1);
  });
});

describe('settings file', () => {
  it('round-trips the API URL with owner-only permissions', async () => {
    const path = join(makeTempDir(), 'nested', 'settings.json');
    expect(await readSettings(path)).toEqual({});
    await writeSettings(path, { apiUrl: 'https://api.test' });
    expect(await readSettings(path)).toEqual({ apiUrl: 'https://api.test' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ apiUrl: 'https://api.test' });
  });

  it('treats a broken file as empty', async () => {
    const path = join(makeTempDir(), 'settings.json');
    writeFileSync(path, '{not json');
    expect(await readSettings(path)).toEqual({});
    writeFileSync(path, JSON.stringify({ apiUrl: 42 }));
    expect(await readSettings(path)).toEqual({});
  });
});
