import { Queue, Worker } from 'bullmq';

import { loadConfig } from './config.js';
import { createDb, type Db } from './db/client.js';
import { QUEUE_NAME, redisConnection } from './pipeline/queue.js';
import { SCHEDULE_TZ, schedules } from './pipeline/schedule.js';
import { handlers, type JobName } from './pipeline/tasks.js';

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const connection = redisConnection(config.redisUrl);

// Register the IST cron schedules (idempotent).
const queue = new Queue(QUEUE_NAME, { connection });
for (const s of schedules) {
  await queue.upsertJobScheduler(s.id, { pattern: s.pattern, tz: SCHEDULE_TZ }, { name: s.job });
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const handler = handlers[job.name as JobName] as ((db: Db, data: unknown) => Promise<unknown>) | undefined;
    if (!handler) throw new Error(`Unknown job ${job.name}`);
    return handler(db, job.data);
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
