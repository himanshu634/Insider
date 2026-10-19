import { Queue } from 'bullmq';

import type { Db } from '../db/client.js';
import { handlers, type JobData, type JobName } from './tasks.js';

export const QUEUE_NAME = 'insider-pipeline';

export interface JobQueue {
  enqueue<N extends JobName>(name: N, data: JobData<N>): Promise<void>;
  close(): Promise<void>;
}

export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

/** Runs jobs in-process, right away. For tests and for dev without Redis. */
export function inlineQueue(db: Db): JobQueue {
  return {
    async enqueue(name, data) {
      const handler = handlers[name] as (db: Db, data: unknown) => Promise<unknown>;
      await handler(db, data);
    },
    async close() {},
  };
}

export function bullQueue(redisUrl: string): JobQueue {
  const queue = new Queue(QUEUE_NAME, { connection: redisConnection(redisUrl) });
  return {
    async enqueue(name, data) {
      await queue.add(name, data ?? {}, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      });
    },
    close: () => queue.close(),
  };
}
