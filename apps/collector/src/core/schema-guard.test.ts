import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { buildFixtureDb, execOnFixture, removeTempDirs } from '../test-support/fixture.js';
import { checkSchema } from './schema-guard.js';
import { REQUIRED_COLUMNS } from './whatsapp-schema.js';

afterAll(removeTempDirs);

function check(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return checkSchema(db);
  } finally {
    db.close();
  }
}

describe('checkSchema', () => {
  it('is ok on the synthetic fixture', () => {
    const result = check(buildFixtureDb());
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same fingerprint for the same schema', () => {
    expect(check(buildFixtureDb()).fingerprint).toBe(check(buildFixtureDb()).fingerprint);
  });

  it('reports a mismatch when a column is dropped', () => {
    const okPrint = check(buildFixtureDb()).fingerprint;
    const path = buildFixtureDb();
    execOnFixture(path, 'ALTER TABLE ZWAMESSAGE DROP COLUMN ZFLAGS;');
    const result = check(path);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['ZWAMESSAGE.ZFLAGS']);
    expect(result.fingerprint).not.toBe(okPrint);
  });

  it('reports every column of a missing table', () => {
    const path = buildFixtureDb();
    execOnFixture(path, 'DROP TABLE ZWAMEDIAITEM;');
    const result = check(path);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(
      REQUIRED_COLUMNS.filter((c) => c.startsWith('ZWAMEDIAITEM.')).sort(),
    );
  });

  it('ignores extra columns WhatsApp adds', () => {
    const okPrint = check(buildFixtureDb()).fingerprint;
    const path = buildFixtureDb();
    execOnFixture(path, 'ALTER TABLE ZWAMESSAGE ADD COLUMN ZNEWTHING INTEGER;');
    expect(check(path)).toMatchObject({ ok: true, fingerprint: okPrint });
  });
});
