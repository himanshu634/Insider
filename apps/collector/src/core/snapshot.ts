import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** A private copy of ChatStorage.sqlite (+ -wal, -shm). Never open the live database. */
export interface Snapshot {
  dir: string;
  dbPath: string;
  cleanup(): Promise<void>;
}

const SNAPSHOT_PREFIX = 'insider-snapshot-';
const SIDECARS = ['', '-wal', '-shm'] as const;

interface FileStamp {
  size: number;
  mtimeMs: number;
}

async function stampOf(path: string): Promise<FileStamp | null> {
  try {
    const s = await stat(path);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function sameStamps(a: (FileStamp | null)[], b: (FileStamp | null)[]): boolean {
  return a.every((x, i) => {
    const y = b[i];
    if (x === null || y === null || y === undefined) return x === y;
    return x.size === y.size && x.mtimeMs === y.mtimeMs;
  });
}

/**
 * Copy the database and its -wal / -shm files together into a fresh directory under `workRoot`.
 *
 * WhatsApp may write while we copy. We compare size + mtime of the source files before and
 * after the copy and retry (up to `attempts`) when they moved; the last copy is used either way.
 * On APFS the copy is a clone (COPYFILE_FICLONE), so it is cheap even for a large database.
 *
 * Throws the underlying fs error (EPERM without Full Disk Access, ENOENT if the file is missing).
 */
export async function createSnapshot(
  sourceDbPath: string,
  workRoot: string = tmpdir(),
  attempts = 3,
): Promise<Snapshot> {
  await mkdir(workRoot, { recursive: true });
  const dir = await mkdtemp(join(workRoot, SNAPSHOT_PREFIX));
  const dbPath = join(dir, basename(sourceDbPath));
  const cleanup = () => rm(dir, { recursive: true, force: true });

  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const before = await Promise.all(SIDECARS.map((s) => stampOf(sourceDbPath + s)));
      if (before[0] === null) {
        const err: NodeJS.ErrnoException = new Error(`WhatsApp database not found: ${sourceDbPath}`);
        err.code = 'ENOENT';
        throw err;
      }
      for (const suffix of SIDECARS) {
        const target = dbPath + suffix;
        await rm(target, { force: true });
        try {
          await copyFile(sourceDbPath + suffix, target, constants.COPYFILE_FICLONE);
        } catch (err) {
          // -wal / -shm are optional (absent after a clean checkpoint).
          if (suffix !== '' && (err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw err;
        }
      }
      const after = await Promise.all(SIDECARS.map((s) => stampOf(sourceDbPath + s)));
      if (sameStamps(before, after)) break;
    }
  } catch (err) {
    await cleanup();
    throw err;
  }

  return { dir, dbPath, cleanup };
}

/** Delete snapshot directories left behind by a crash. They hold private messages. */
export async function removeStaleSnapshots(workRoot: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(workRoot);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((name) => name.startsWith(SNAPSHOT_PREFIX))
      .map((name) => rm(join(workRoot, name), { recursive: true, force: true })),
  );
}
