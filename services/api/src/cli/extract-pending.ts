/**
 * Run the per-message chain on text messages that have no label yet, for example those ingested while
 * ANTHROPIC_API_KEY was unset: pnpm --filter @insider/api extract-pending [--limit n]
 * Runs in this process, then rebuilds the daily prices it touched, so it needs no Redis or worker.
 */
import { parseArgs } from 'node:util';

import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { createAnthropic } from '../llm/client.js';
import { aggregateDirty } from '../pipeline/aggregate.js';
import { pendingExtraction, processMessage } from '../pipeline/tasks.js';

const { values } = parseArgs({ options: { limit: { type: 'string', default: '100' } } });
const config = loadConfig();
const anthropic = createAnthropic(config);
if (!anthropic) {
  console.error('Set ANTHROPIC_API_KEY first.');
  process.exit(1);
}
const { db, close } = createDb(config.databaseUrl);
const ids = await pendingExtraction(db, Number(values.limit));
for (const [i, messageId] of ids.entries()) {
  await processMessage({ db, anthropic, config }, { messageId });
  console.log(`${i + 1}/${ids.length} message ${messageId}`);
}
// The worker's 15-minute job does this too; run it here so daily prices show without one.
console.log(`daily prices rebuilt for ${await aggregateDirty(db)} cells`);
await close();
