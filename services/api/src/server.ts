import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createAnthropic } from './llm/client.js';
import { bullQueue, inlineQueue } from './pipeline/queue.js';

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const queue = config.queueInline ? inlineQueue(db) : bullQueue(config.redisUrl);
const anthropic = createAnthropic(config);

const server = serve(
  { fetch: createApp({ db, queue, config, anthropic }).fetch, port: config.port, hostname: config.host }, (info) =>
  console.log(
    `Insider API on http://${config.host}:${info.port} (jobs: ${config.queueInline ? 'inline' : 'BullMQ'})`,
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
