import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const DEFAULT_API_URL = 'http://localhost:8000';
export const DEFAULT_WEB_URL = 'http://localhost:5173';
export const DEFAULT_SYNC_INTERVAL_SECONDS = 90;
export const MIN_SYNC_INTERVAL_SECONDS = 15;
export const DEFAULT_WA_DB =
  '~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite';

export interface CollectorConfig {
  /** INSIDER_API_URL. A URL saved in the Connect window wins over it. */
  apiUrl: string;
  /** From env (dev). The packaged app keeps its token in a safeStorage file instead. */
  deviceToken: string | undefined;
  /** Absolute path of the WhatsApp database (or the dev fixture). Only ever snapshotted. */
  waDbPath: string;
  /**
   * Dev fallback (SENDER_HMAC_KEY). The server sends its key in GET /v1/devices/config, and that
   * key wins; with neither, the collector reads no messages.
   */
  senderHmacKey: string | undefined;
  syncIntervalSeconds: number;
  webUrl: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** Expand `~/` and resolve relative paths against `baseDir`. */
export function resolvePath(path: string, home: string, baseDir: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

export function parseInterval(value: string | undefined): number {
  const n = Number(value);
  if (!value || !Number.isFinite(n)) return DEFAULT_SYNC_INTERVAL_SECONDS;
  return Math.max(MIN_SYNC_INTERVAL_SECONDS, Math.round(n));
}

/**
 * Read collector settings from the environment. Relative INSIDER_WA_DB paths resolve against
 * INIT_CWD (the directory pnpm was started from, i.e. the repo root under bin/insider), falling
 * back to the process working directory.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): CollectorConfig {
  const baseDir = nonEmpty(env.INIT_CWD) ?? process.cwd();
  return {
    apiUrl: (nonEmpty(env.INSIDER_API_URL) ?? DEFAULT_API_URL).replace(/\/+$/, ''),
    deviceToken: nonEmpty(env.INSIDER_DEVICE_TOKEN),
    waDbPath: resolvePath(nonEmpty(env.INSIDER_WA_DB) ?? DEFAULT_WA_DB, home, baseDir),
    senderHmacKey: nonEmpty(env.SENDER_HMAC_KEY),
    syncIntervalSeconds: parseInterval(env.INSIDER_SYNC_INTERVAL_SECONDS),
    webUrl: nonEmpty(env.INSIDER_WEB_URL) ?? DEFAULT_WEB_URL,
  };
}
