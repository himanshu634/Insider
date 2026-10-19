/**
 * Backfill a WhatsApp .txt chat export through the ingest API.
 *
 *   pnpm --filter @insider/export-importer backfill FILE --group-jid 1203...@g.us \
 *     --api-url http://localhost:8000 --token $INSIDER_DEVICE_TOKEN [--dry-run]
 *
 * Note `run`: `pnpm import` is a pnpm built-in (lockfile import), so the bare
 * `pnpm --filter ... import` form does not reach this script.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { components } from '@insider/contracts';
import { ExportParseError, parseExport, type DateFormat } from './parse.js';
import { chunk, GROUP_JID_PATTERN, MAX_BATCH, toIngest, TZ_OFFSET_MINUTES, type IngestMessage } from './toIngest.js';

type IngestResponse = components['schemas']['IngestMessagesResponse'];

const USAGE = `Usage: pnpm --filter @insider/export-importer backfill FILE [options]

Parse a WhatsApp "Export chat" .txt file (Android or iOS) and post it to
POST /v1/ingest/messages in batches of ${MAX_BATCH}.

Options:
  --group-jid JID        Group JID the export belongs to (must end with @g.us). Required.
  --api-url URL          API base URL (default: $INSIDER_API_URL). Required unless --dry-run.
  --token TOKEN          Device bearer token (default: $INSIDER_DEVICE_TOKEN). Required unless --dry-run.
  --hmac-key KEY         Sender HMAC key (default: $SENDER_HMAC_KEY). Must match the API's key.
  --tz ZONE              Timezone the export was written in (default: Asia/Kolkata).
                         Supported: ${Object.keys(TZ_OFFSET_MINUTES).join(', ')}
  --date-format dmy|mdy  Day/month order in the export (default: dmy).
  --dry-run              Parse and print a summary; send nothing.
  -h, --help             Show this help.

Relative FILE paths resolve against the directory you ran pnpm from.`;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function postBatch(url: string, token: string, messages: IngestMessage[]): Promise<IngestResponse> {
  const body = JSON.stringify({ messages });
  let lastError = '';
  // Ingest is idempotent on (group, stanza_id), so retrying a batch is safe.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body,
      });
      if (res.ok) return (await res.json()) as IngestResponse;
      const text = await res.text();
      lastError = `HTTP ${res.status}: ${text.slice(0, 2000)}`;
      if (res.status < 500) break; // 4xx will not get better on retry
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
  }
  throw new Error(lastError);
}

async function main(): Promise<void> {
  // pnpm may forward a literal "--" separator; drop it so flags still parse.
  const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'group-jid': { type: 'string' },
        'api-url': { type: 'string' },
        token: { type: 'string' },
        'hmac-key': { type: 'string' },
        tz: { type: 'string', default: 'Asia/Kolkata' },
        'date-format': { type: 'string', default: 'dmy' },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return;
  }

  if (positionals.length !== 1) fail(`expected exactly one FILE argument\n\n${USAGE}`);
  const groupJid = values['group-jid'];
  if (!groupJid) fail('--group-jid is required');
  if (!GROUP_JID_PATTERN.test(groupJid)) fail(`--group-jid must end with @g.us, got "${groupJid}"`);
  const dateFormat = values['date-format'];
  if (dateFormat !== 'dmy' && dateFormat !== 'mdy') fail('--date-format must be dmy or mdy');
  const tz = values.tz;
  if (!(tz in TZ_OFFSET_MINUTES)) fail(`unsupported --tz "${tz}" (supported: ${Object.keys(TZ_OFFSET_MINUTES).join(', ')})`);

  const dryRun = values['dry-run'];
  const apiUrl = values['api-url'] ?? process.env.INSIDER_API_URL;
  const token = values.token ?? process.env.INSIDER_DEVICE_TOKEN;
  let hmacKey = values['hmac-key'] ?? process.env.SENDER_HMAC_KEY;
  if (!dryRun) {
    if (!apiUrl) fail('--api-url (or INSIDER_API_URL) is required');
    if (!token) fail('--token (or INSIDER_DEVICE_TOKEN) is required');
    if (!hmacKey) fail('--hmac-key (or SENDER_HMAC_KEY) is required and must match the API');
  } else if (!hmacKey) {
    console.warn('warning: no SENDER_HMAC_KEY; dry run uses a placeholder key, sender hashes will not match the API');
    hmacKey = 'dry-run-placeholder-key';
  }

  // pnpm runs scripts from the package directory; INIT_CWD is where the user ran pnpm.
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0]!);
  let input: string;
  try {
    input = readFileSync(file, 'utf8');
  } catch (err) {
    fail(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  let result;
  try {
    result = parseExport(input, { dateFormat: dateFormat as DateFormat });
  } catch (err) {
    if (err instanceof ExportParseError) fail(`${file}: ${err.message}`);
    throw err;
  }
  const messages = toIngest(result.messages, { groupJid, hmacKey, tz });

  const byType: Record<string, number> = {};
  for (const m of messages) byType[m.type] = (byType[m.type] ?? 0) + 1;
  const ids = new Set(messages.map((m) => m.stanza_id));
  console.log(`file:      ${file}`);
  console.log(`messages:  ${messages.length} (${Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(', ') || 'none'})`);
  console.log(`skipped:   ${result.skippedSystem} system, ${result.skippedDeleted} deleted, ${result.skippedPreamble} preamble lines`);
  if (ids.size !== messages.length) {
    console.log(`collisions: ${messages.length - ids.size} messages share a stanza_id with an earlier one (same sender, minute and text); the API will count them as duplicates`);
  }
  if (messages.length > 0) {
    console.log(`range:     ${messages[0]!.sent_at} .. ${messages[messages.length - 1]!.sent_at} (UTC, from ${tz})`);
  }

  if (dryRun) {
    console.log('\nfirst messages (dry run, nothing sent):');
    console.log(JSON.stringify(messages.slice(0, 3), null, 2));
    return;
  }
  if (messages.length === 0) return;

  const url = new URL('/v1/ingest/messages', apiUrl).toString();
  const totals = { accepted: 0, duplicate: 0, rejected: 0 };
  const batches = chunk(messages, MAX_BATCH);
  for (const [i, batch] of batches.entries()) {
    let res: IngestResponse;
    try {
      res = await postBatch(url, token!, batch);
    } catch (err) {
      console.error(`batch ${i + 1}/${batches.length} failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`so far: ${totals.accepted} accepted, ${totals.duplicate} duplicate, ${totals.rejected} rejected. Re-running is safe (idempotent).`);
      process.exit(1);
    }
    totals.accepted += res.accepted;
    totals.duplicate += res.duplicate;
    totals.rejected += res.rejected;
    console.log(`batch ${i + 1}/${batches.length}: ${res.accepted} accepted, ${res.duplicate} duplicate, ${res.rejected} rejected`);
    for (const r of res.results) {
      if (r.status === 'rejected') console.log(`  rejected ${r.stanza_id}: ${r.error ?? 'no reason given'}`);
    }
  }
  console.log(`done: ${totals.accepted} accepted, ${totals.duplicate} duplicate, ${totals.rejected} rejected`);
  if (totals.rejected > 0) process.exitCode = 2;
}

await main();
