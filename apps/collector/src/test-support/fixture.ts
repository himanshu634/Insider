import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/** packages/fixtures/chatstorage/synthetic.sql (synthetic data only). */
export const SYNTHETIC_SQL_PATH = fileURLToPath(
  new URL('../../../../packages/fixtures/chatstorage/synthetic.sql', import.meta.url),
);

export const G1 = '120363000000000001@g.us'; // Gondal Castor Rates
export const G2 = '120363000000000002@g.us'; // Rajkot Groundnut Bazaar
export const G3 = '120363000000000003@g.us'; // ગુજરાત મંડી ભાવ
export const DM = '910000000999@s.whatsapp.net'; // 1:1 chat, must be ignored
export const TEST_HMAC_KEY = 'test-sender-hmac-key';

const tempDirs: string[] = [];

export function makeTempDir(prefix = 'insider-collector-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Build ChatStorage.sqlite from the synthetic SQL in `dir` (a fresh temp dir by default). */
export function buildFixtureDb(dir: string = makeTempDir()): string {
  const path = join(dir, 'ChatStorage.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(readFileSync(SYNTHETIC_SQL_PATH, 'utf8'));
  } finally {
    db.close();
  }
  return path;
}

/** Run SQL against a fixture database (to add messages or break the schema). */
export function execOnFixture(path: string, sql: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}
