import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDirs } from '../test-support/fixture.js';
import { createSnapshot, removeStaleSnapshots } from './snapshot.js';

afterAll(removeTempDirs);

describe('createSnapshot', () => {
  it('copies db + -wal + -shm so uncheckpointed rows are visible read-only', async () => {
    const src = join(makeTempDir(), 'ChatStorage.sqlite');
    const writer = new DatabaseSync(src);
    // Keep the writer open: closing the last connection checkpoints and deletes the -wal.
    writer.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
    writer.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1), (2), (3);');
    expect(existsSync(`${src}-wal`)).toBe(true);

    const snap = await createSnapshot(src, makeTempDir());
    try {
      expect(readdirSync(snap.dir).sort()).toEqual([
        'ChatStorage.sqlite',
        'ChatStorage.sqlite-shm',
        'ChatStorage.sqlite-wal',
      ]);
      const copy = new DatabaseSync(snap.dbPath, { readOnly: true });
      expect(copy.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 3 });
      copy.close();
    } finally {
      await snap.cleanup();
      writer.close();
    }
    expect(existsSync(snap.dir)).toBe(false);
  });

  it('works without -wal / -shm files', async () => {
    const src = join(makeTempDir(), 'plain.sqlite');
    const db = new DatabaseSync(src);
    db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1);');
    db.close();
    const snap = await createSnapshot(src, makeTempDir());
    expect(readdirSync(snap.dir)).toEqual(['plain.sqlite']);
    await snap.cleanup();
  });

  it('throws ENOENT for a missing database and leaves nothing behind', async () => {
    const root = makeTempDir();
    await expect(createSnapshot(join(root, 'missing.sqlite'), root)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('removeStaleSnapshots', () => {
  it('deletes only snapshot directories', async () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'insider-snapshot-abc'));
    mkdirSync(join(root, 'keep-me'));
    await removeStaleSnapshots(root);
    expect(readdirSync(root)).toEqual(['keep-me']);
    await removeStaleSnapshots(join(root, 'does-not-exist'));
  });
});
