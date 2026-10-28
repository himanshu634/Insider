import { Queue, Worker } from 'bullmq';

import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createAnthropic } from './llm/client.js';
import { QUEUE_NAME, redisConnection } from './pipeline/queue.js';
import { SCHEDULE_TZ, schedules } from './pipeline/schedule.js';
import { handlers, type JobName, type PipelineDeps } from './pipeline/tasks.js';

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const connection = redisConnection(config.redisUrl);
const deps: PipelineDeps = { db, anthropic: createAnthropic(config), config };
if (!deps.anthropic) console.warn('ANTHROPIC_API_KEY is unset: messages stop after the rule gate until extract-pending runs');

// Register the IST cron schedules (idempotent).
const queue = new Queue(QUEUE_NAME, { connection });
for (const s of schedules) {
  await queue.upsertJobScheduler(s.id, { pattern: s.pattern, tz: SCHEDULE_TZ }, { name: s.job });
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const handler = handlers[job.name as JobName] as ((deps: PipelineDeps, data: unknown) => Promise<unknown>) | undefined;
    if (!handler) throw new Error(`Unknown job ${job.name}`);
    return handler(deps, job.data);
  },
  { connection, concurrency: 4 },
);
worker.on('failed', (job, err) => console.error(`Job ${job?.name} ${job?.id} failed:`, err));
console.log(`Worker listening on ${QUEUE_NAME}; ${schedules.length} schedules (${SCHEDULE_TZ})`);

async function shutdown() {
  await worker.close();
  await queue.close();
  await close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
