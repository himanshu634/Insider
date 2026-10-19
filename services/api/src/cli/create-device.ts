/** Register a collector and print its token: pnpm --filter @insider/api create-device <name> [--token t] */
import { parseArgs } from 'node:util';

import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { collectorDevice } from '../db/schema.js';
import { hashToken, newDeviceToken } from '../security.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { token: { type: 'string' } },
});
const name = positionals[0];
if (!name) {
  console.error('Usage: create-device <name> [--token <dev token>]');
  process.exit(1);
}
const token = values.token ?? newDeviceToken();
const { db, close } = createDb(loadConfig().databaseUrl);
await db
  .insert(collectorDevice)
  .values({ name, tokenHash: hashToken(token) })
  .onConflictDoNothing({ target: collectorDevice.tokenHash });
await close();
console.log(token);
