import { open } from 'node:fs/promises';
import { basename } from 'node:path';

export type DbAccess = 'ok' | 'denied' | 'missing';

/** macOS System Settings → Privacy & Security → Full Disk Access. */
export const FULL_DISK_ACCESS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

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

export interface ProcessEntry {
  pid: number;
  ppid: number;
  /** Full path of the executable (macOS `ps -o comm`). May contain spaces. */
  path: string;
}

/** Parse `ps -A -o pid=,ppid=,comm=`. */
export function parseProcessList(output: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of output.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) entries.push({ pid: Number(m[1]), ppid: Number(m[2]), path: m[3]! });
  }
  return entries;
}

/**
 * The outermost `.app` bundle of an app executable (`X.app/Contents/MacOS/x`), else null. Helper
 * apps nest inside their app (`Visual Studio Code.app/…/Code Helper.app/Contents/MacOS/…`); the
 * Full Disk Access list shows the outer one. Tools that only live in a bundle
 * (`Xcode.app/Contents/Developer/usr/bin/make`) are not apps.
 */
export function appBundleOf(path: string): string | null {
  if (!/\.app\/Contents\/MacOS\/[^/]+$/.test(path)) return null;
  return path.slice(0, path.indexOf('.app/') + '.app'.length);
}

/** The app (or bare executable) that macOS checks for Full Disk Access. */
export interface AccessHolder {
  /** As the Full Disk Access list shows it, e.g. "Visual Studio Code". */
  name: string;
  /** The `.app` bundle, or the executable when it is not in one. */
  path: string;
}

function holderAt(path: string): AccessHolder {
  const bundle = appBundleOf(path);
  return bundle ? { name: basename(bundle, '.app'), path: bundle } : { name: basename(path), path };
}

/**
 * Guess the app macOS holds responsible for this process. TCC checks that app, not the process
 * itself. An app opened by launchd (Finder, login item, `open`) is responsible for itself. A
 * process started from a terminal or editor belongs to that app: the nearest ancestor that is an
 * app. Some apps start children through a `disclaimer` helper; such a child is responsible for
 * itself. macOS does not expose this to Node, so this is a best guess; null when nothing fits.
 */
export function findAccessHolder(processes: readonly ProcessEntry[], selfPid: number): AccessHolder | null {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const self = byPid.get(selfPid);
  if (!self) return null;
  if (self.ppid === 1) return holderAt(self.path);

  const seen = new Set<number>();
  let current = byPid.get(self.ppid);
  while (current && current.pid > 1 && !seen.has(current.pid)) {
    seen.add(current.pid);
    if (appBundleOf(current.path)) return holderAt(current.path);
    const parent = byPid.get(current.ppid);
    if (parent && basename(parent.path) === 'disclaimer') return holderAt(current.path);
    current = parent;
  }
  return null;
}
