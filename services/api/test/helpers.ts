import type Anthropic from '@anthropic-ai/sdk';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { MIGRATIONS_OPTIONS } from '../src/db/migrations.js';
import * as schema from '../src/db/schema.js';
import { inlineQueue } from '../src/pipeline/queue.js';
import { hashToken } from '../src/security.js';

export const DEVICE_TOKEN = 'test-device-token';

/** A fresh in-process Postgres with the real migrations applied, plus the app on top of it. */
export async function setup(opts: { anthropic?: Anthropic | null } = {}) {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client), MIGRATIONS_OPTIONS);
  const config = loadConfig();
  const app = createApp({ db, queue: inlineQueue(db), config, anthropic: opts.anthropic ?? null });
  await db.insert(schema.collectorDevice).values({ name: 'test-mac', tokenHash: hashToken(DEVICE_TOKEN) });

  const request = (path: string, init: RequestInit & { json?: unknown; device?: boolean } = {}) => {
    const headers = new Headers(init.headers);
    if (init.device !== false) headers.set('authorization', `Bearer ${DEVICE_TOKEN}`);
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    const res = app.request(path, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    // Tests read loosely-typed JSON; response shapes are checked against the spec in contract.test.ts.
    return res as Promise<Omit<Response, 'json'> & { json(): Promise<any> }>;
  };
  return { db, client, app, request, close: () => client.close() };
}
