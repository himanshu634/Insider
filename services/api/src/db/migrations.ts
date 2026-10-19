import { fileURLToPath } from 'node:url';

import { DB_SCHEMA } from '../config.js';

export const MIGRATIONS_OPTIONS = {
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  migrationsSchema: DB_SCHEMA,
  migrationsTable: '__drizzle_migrations',
};
