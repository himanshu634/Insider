import type { DatabaseSync } from 'node:sqlite';

/** Run `fn` in one IMMEDIATE transaction; roll back if it throws. Not re-entrant. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
