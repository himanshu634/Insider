import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { REQUIRED_COLUMNS, WHATSAPP_TABLES } from './whatsapp-schema.js';

export interface SchemaCheck {
  ok: boolean;
  /** sha256 (hex) of the sorted `table.column` names we use that exist in this database. */
  fingerprint: string;
  /** Required `table.column` names that are missing. Empty when ok. */
  missing: string[];
}

/** Compare the snapshot's schema with the names in whatsapp-schema.ts. */
export function checkSchema(db: DatabaseSync): SchemaCheck {
  const present = new Set<string>();
  const columnsOf = db.prepare('SELECT name FROM pragma_table_info(?)');
  for (const { table } of WHATSAPP_TABLES) {
    for (const row of columnsOf.all(table)) {
      present.add(`${table}.${String(row.name)}`);
    }
  }
  const used = [...REQUIRED_COLUMNS].sort();
  const existing = used.filter((c) => present.has(c));
  const missing = used.filter((c) => !present.has(c));
  const fingerprint = createHash('sha256').update(existing.join('\n')).digest('hex');
  return { ok: missing.length === 0, fingerprint, missing };
}
