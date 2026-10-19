import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { collectorDevice } from './db/schema.js';
import type { JobQueue } from './pipeline/queue.js';

export interface User {
  id: string;
  name: string;
}

export interface AppDeps {
  db: Db;
  queue: JobQueue;
  config: Config;
}

export type AppEnv = {
  Variables: AppDeps & {
    device: typeof collectorDevice.$inferSelect;
    user: User;
  };
};
