import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { bullQueue, inlineQueue } from './pipeline/queue.js';

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const queue = config.queueInline ? inlineQueue(db) : bullQueue(config.redisUrl);

const server = serve({ fetch: createApp({ db, queue, config }).fetch, port: config.port }, (info) =>
  console.log(
    `Insider API on http://localhost:${info.port} (jobs: ${config.queueInline ? 'inline' : 'BullMQ'})`,
  ),
);

async function shutdown() {
  server.close();
  await queue.close();
  await close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
