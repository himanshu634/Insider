import { open } from 'node:fs/promises';

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
