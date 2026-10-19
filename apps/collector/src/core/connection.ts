import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ApiClient, ApiError } from './api-client.js';
import type { DeviceConfig } from './types.js';

/** What the Connect window collects. The token is stored with safeStorage, the URL in settings. */
export interface Connection {
  apiUrl: string;
  deviceToken: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_TOKEN_LENGTH = 512;

/**
 * Trim and check what was typed. The API URL must be https, except on this Mac (dev), because
 * the device token goes in every request. Trailing slashes are dropped.
 */
export function normalizeConnection(input: { apiUrl: unknown; deviceToken: unknown }): Checked<Connection> {
  const rawUrl = typeof input.apiUrl === 'string' ? input.apiUrl.trim() : '';
  const deviceToken = typeof input.deviceToken === 'string' ? input.deviceToken.trim() : '';
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Enter the API URL, for example https://insider.example.com' };
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    return { ok: false, error: 'The API URL must start with https:// (http:// only for localhost)' };
  }
  if (url.username || url.password || url.search || url.hash) {
    return { ok: false, error: 'The API URL must not contain a user name, query or #fragment' };
  }
  if (!deviceToken) return { ok: false, error: 'Enter the device token' };
  if (deviceToken.length > MAX_TOKEN_LENGTH || /\s/.test(deviceToken)) {
    return { ok: false, error: 'That does not look like a device token' };
  }
  const apiUrl = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  return { ok: true, value: { apiUrl, deviceToken } };
}

export interface TestConnectionOptions {
  fetch?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
}

/** One GET /v1/devices/config with the new token, no retries, before anything is saved. */
export async function testConnection(
  conn: Connection,
  options: TestConnectionOptions = {},
): Promise<Checked<DeviceConfig>> {
  const api = new ApiClient({
    baseUrl: conn.apiUrl,
    deviceToken: conn.deviceToken,
    retries: 0,
    timeoutMs: options.timeoutMs ?? 10_000,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
  });
  try {
    return { ok: true, value: await api.getDeviceConfig() };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.status === 403) {
        return { ok: false, error: 'The server did not accept this device token' };
      }
      if (err.status === 0) return { ok: false, error: `Could not reach ${conn.apiUrl}` };
      if (err.status === 404) return { ok: false, error: 'No Insider API at this URL' };
      return { ok: false, error: `The server answered ${err.status}; try again later` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Non-secret settings saved by the Connect window (userData/settings.json). */
export interface StoredSettings {
  apiUrl?: string;
}

/** Missing or unreadable settings are treated as empty. */
export async function readSettings(path: string): Promise<StoredSettings> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const apiUrl = (parsed as Record<string, unknown>).apiUrl;
    return typeof apiUrl === 'string' && apiUrl ? { apiUrl } : {};
  } catch {
    return {};
  }
}

/** Write via a temp file and rename, so a crash never leaves half a file. */
export async function writeSettings(path: string, settings: StoredSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}
