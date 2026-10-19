import { defineConfig } from 'drizzle-kit';

// Insider owns the `market_intel` Postgres schema and nothing else — including drizzle's own
// migrations journal — so a shared Supabase database (Bull Connect's tables in `public`) is
// never touched.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['market_intel'],
  migrations: { schema: 'market_intel', table: '__drizzle_migrations' },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://insider@localhost:54329/insider',
  },
});
