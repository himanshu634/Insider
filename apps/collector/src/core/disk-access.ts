import { open } from 'node:fs/promises';
import { basename } from 'node:path';

export type DbAccess = 'ok' | 'denied' | 'missing';

/** macOS System Settings → Privacy & Security → Full Disk Access. */
export const FULL_DISK_ACCESS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/** The .app bundle that holds `execPath`, or null when it is not inside one. */
export function appBundlePath(execPath: string): string | null {
  return /^(.+?\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)?.[1] ?? null;
}

export interface FullDiskAccessHelp {
  steps: string[];
  /** A bundle to show in Finder, so it can be dragged into the Full Disk Access list. */
  reveal: string | null;
}

/**
 * The steps in the Full Disk Access prompt. macOS grants access to the app the process runs as:
 * the packaged app, the dev copy that bin/insider builds (.dev/Insider Collector.app), or, for a
 * bare `electron .`, the terminal that started it.
 */
export function fullDiskAccessHelp(execPath: string, isPackaged: boolean): FullDiskAccessHelp {
  const openSettings = '1. Click “Open System Settings” (Privacy & Security → Full Disk Access).';
  if (isPackaged) {
    return {
      steps: [
        openSettings,
        '2. Turn on “Insider Collector” (use + to add it from Applications if it is not listed).',
        '3. Quit and reopen Insider Collector.',
      ],
      reveal: null,
    };
  }
  const bundle = appBundlePath(execPath);
  if (bundle && basename(bundle) !== 'Electron.app') {
    return {
      steps: [
        openSettings,
        '2. Turn on “Insider Collector”. If it is not listed, drag it into the list from the Finder window that opens.',
        '3. Stop the collector (Ctrl-C) and start it again.',
      ],
      reveal: bundle,
    };
  }
  return {
    steps: [
      openSettings,
      '2. Turn on the terminal app you started the collector from,',
      '   or run `make collector-real`, which runs it as its own app, “Insider Collector”.',
      '3. Restart the collector.',
    ],
    reveal: null,
  };
}

export function isPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EACCES';
}

/**
 * Try to read the first bytes of the database. Without Full Disk Access, macOS (TCC) refuses
 * files under ~/Library/Group Containers with EPERM.
 */
export async function checkDbAccess(path: string): Promise<DbAccess> {
  try {
    const handle = await open(path, 'r');
    try {
      await handle.read(Buffer.alloc(16), 0, 16, 0);
    } finally {
      await handle.close();
    }
    return 'ok';
  } catch (err) {
    if (isPermissionError(err)) return 'denied';
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
}
