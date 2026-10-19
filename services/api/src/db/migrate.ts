import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { loadConfig } from '../config.js';
import { MIGRATIONS_OPTIONS } from './migrations.js';

const client = postgres(loadConfig().databaseUrl, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), MIGRATIONS_OPTIONS);
await client.end();
console.log('Migrations applied');
