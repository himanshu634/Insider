import type Anthropic from '@anthropic-ai/sdk';

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
  /** Null when ANTHROPIC_API_KEY is unset: POST /v1/ask answers 501. */
  anthropic: Anthropic | null;
}

export type AppEnv = {
  Variables: AppDeps & {
    device: typeof collectorDevice.$inferSelect;
    user: User;
  };
};
