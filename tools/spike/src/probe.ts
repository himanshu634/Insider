/**
 * Phase 0 probe: inspect WhatsApp Desktop's ChatStorage.sqlite.
 *
 * Never touches the live database: it copies ChatStorage.sqlite (+ -wal,
 * -shm) into a fresh temp dir, opens the copy read-only, prints the schema
 * of the tables the collector depends on, lists groups and dumps the last N
 * days of group messages to CSV. The temp copy is deleted at the end.
 *
 * Table and column names are not documented by WhatsApp. Every query is
 * built from PRAGMA table_info, so a missing column becomes NULL plus a
 * warning instead of a crash. Finding those differences is the point of
 * Phase 0.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

const DEFAULT_DB = path.join(
  os.homedir(),
  'Library',
  'Group Containers',
  'group.net.whatsapp.WhatsApp.shared',
  'ChatStorage.sqlite',
);
/** Core Data stores dates as seconds since 2001-01-01T00:00:00Z. */
const APPLE_EPOCH_OFFSET_S = 978_307_200;
const TABLES = ['ZWACHATSESSION', 'ZWAMESSAGE', 'ZWAGROUPMEMBER', 'ZWAMEDIAITEM'] as const;
type Table = (typeof TABLES)[number];

const USAGE = `Usage: pnpm --filter @insider/spike probe [options]

Copies WhatsApp Desktop's ChatStorage.sqlite (+ -wal, -shm) to a temp dir,
opens the COPY read-only and prints:
  - every table name, and the columns of ${TABLES.join(', ')}
  - all groups (JIDs ending in @g.us) with message counts
  - a CSV of group messages from the last N days

Options:
  --db PATH     Database to copy (default: ${DEFAULT_DB})
  --days N      How many days of group messages to dump (default: 7)
  --out PATH    CSV path (default: tools/spike/out/group-messages-last-<N>d.csv)
  --keep-copy   Keep the temp copy and print its path (default: delete it)
  -h, --help    Show this help

Reading the default path needs Full Disk Access for the app running this
command (Terminal, iTerm, VS Code, ...): System Settings > Privacy & Security >
Full Disk Access. Relative --db/--out paths resolve against the directory you
ran pnpm from. The CSV holds private messages: keep it out of git and delete it
when done (tools/spike/out/ is git-ignored).`;

class ProbeError extends Error {}

function terminalApp(): string {
  const term = process.env.TERM_PROGRAM;
  if (term === 'Apple_Terminal') return 'Terminal';
  if (term === 'iTerm.app') return 'iTerm';
  if (term === 'vscode') return 'Visual Studio Code (or Cursor)';
  return term ? term : 'the app running this command (Terminal, iTerm, VS Code, ...)';
}

function copySnapshot(dbPath: string, tmpDir: string): string {
  const dest = path.join(tmpDir, path.basename(dbPath));
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.copyFileSync(dbPath + suffix, dest + suffix);
      console.log(`copied  ${path.basename(dbPath + suffix)} (${fs.statSync(dest + suffix).size} bytes)`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' && suffix !== '') {
        console.log(`skipped ${path.basename(dbPath + suffix)} (not present)`);
        continue;
      }
      if (code === 'EPERM' || code === 'EACCES') {
        throw new ProbeError(
          `Permission denied reading ${dbPath + suffix}.\n` +
            `macOS blocks access to ~/Library/Group Containers without Full Disk Access.\n` +
            `Grant it to ${terminalApp()} in System Settings > Privacy & Security > Full Disk Access,\n` +
            `then quit and reopen that app and run the probe again.`,
        );
      }
      if (code === 'ENOENT') {
        throw new ProbeError(
          `No database at ${dbPath}.\nIs WhatsApp Desktop installed and linked? Pass --db to point at another copy.`,
        );
      }
      throw err;
    }
  }
  return dest;
}

function tableColumns(db: DatabaseSync, table: string): Map<string, string> {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all();
  return new Map(rows.map((r) => [String(r.name), String(r.type ?? '')]));
}

function cell(v: SQLOutputValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Uint8Array) return `<blob ${v.byteLength} bytes>`;
  return String(v);
}

function csvField(v: SQLOutputValue | undefined): string {
  const s = cell(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function appleDateToIso(v: SQLOutputValue | undefined): string {
  if (typeof v !== 'number' && typeof v !== 'bigint') return '';
  const ms = (Number(v) + APPLE_EPOCH_OFFSET_S) * 1000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function printTable(rows: Array<Record<string, string>>, headers: string[]): void {
  const widths = headers.map((h) => Math.min(60, Math.max(h.length, ...rows.map((r) => (r[h] ?? '').length))));
  const line = (vals: string[]) => vals.map((v, i) => v.slice(0, 60).padEnd(widths[i]!)).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(headers.map((h) => r[h] ?? '')));
}

function probe(db: DatabaseSync, days: number, outPath: string): void {
  // 1. Tables and columns
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all()
    .map((r) => String(r.name));
  console.log(`\n== Tables (${tables.length}) ==\n${tables.join(', ')}`);

  const cols = new Map<Table, Map<string, string>>();
  for (const t of TABLES) {
    const c = tableColumns(db, t);
    cols.set(t, c);
    console.log(`\n== ${t} ==`);
    if (c.size === 0) {
      console.log('  MISSING: table not found');
      continue;
    }
    const count = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get();
    console.log(`  rows: ${cell(count?.n)}`);
    for (const [name, type] of c) console.log(`  ${name.padEnd(28)} ${type}`);
  }

  const has = (t: Table, c: string) => cols.get(t)?.has(c) ?? false;
  const missing: string[] = [];
  // Expression for `alias.column`, or NULL (and a warning) when the column is absent.
  const col = (alias: string, t: Table, c: string, as: string) => {
    if (has(t, c)) return `${alias}."${c}" AS ${as}`;
    missing.push(`${t}.${c}`);
    return `NULL AS ${as}`;
  };

  for (const [t, c] of [
    ['ZWACHATSESSION', 'Z_PK'],
    ['ZWACHATSESSION', 'ZCONTACTJID'],
    ['ZWAMESSAGE', 'ZCHATSESSION'],
    ['ZWAMESSAGE', 'ZMESSAGEDATE'],
  ] as const) {
    if (!has(t, c)) {
      throw new ProbeError(`${t}.${c} not found; cannot list groups or messages. Compare the columns printed above with WhatsAppSchema.`);
    }
  }

  // 2. Groups
  const groupSql = `
    SELECT s.Z_PK AS pk,
           s.ZCONTACTJID AS jid,
           ${col('s', 'ZWACHATSESSION', 'ZPARTNERNAME', 'name')},
           ${col('s', 'ZWACHATSESSION', 'ZLASTMESSAGEDATE', 'last_message_date')},
           (SELECT COUNT(*) FROM ZWAMESSAGE m WHERE m.ZCHATSESSION = s.Z_PK) AS messages
    FROM ZWACHATSESSION s
    WHERE s.ZCONTACTJID LIKE '%@g.us'
    ORDER BY messages DESC`;
  const groups = db.prepare(groupSql).all();
  console.log(`\n== Groups (${groups.length}) ==`);
  printTable(
    groups.map((g) => ({
      pk: cell(g.pk),
      jid: cell(g.jid),
      name: cell(g.name),
      messages: cell(g.messages),
      last_message_utc: appleDateToIso(g.last_message_date),
    })),
    ['pk', 'jid', 'name', 'messages', 'last_message_utc'],
  );

  // 3. Group messages of the last N days
  const select = [
    `m.Z_PK AS message_pk`,
    col('m', 'ZWAMESSAGE', 'ZSTANZAID', 'stanza_id'),
    `s.ZCONTACTJID AS group_jid`,
    col('s', 'ZWACHATSESSION', 'ZPARTNERNAME', 'group_name'),
    `m.ZMESSAGEDATE AS message_date_raw`,
    col('m', 'ZWAMESSAGE', 'ZISFROMME', 'is_from_me'),
    col('m', 'ZWAMESSAGE', 'ZFROMJID', 'from_jid'),
    col('m', 'ZWAMESSAGE', 'ZPUSHNAME', 'push_name'),
    col('m', 'ZWAMESSAGE', 'ZMESSAGETYPE', 'message_type'),
    col('m', 'ZWAMESSAGE', 'ZGROUPEVENTTYPE', 'group_event_type'),
    col('m', 'ZWAMESSAGE', 'ZTEXT', 'text'),
  ];
  const joins: string[] = [];
  if (has('ZWAMESSAGE', 'ZGROUPMEMBER') && has('ZWAGROUPMEMBER', 'Z_PK')) {
    joins.push(`LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER`);
    select.push(col('gm', 'ZWAGROUPMEMBER', 'ZMEMBERJID', 'member_jid'));
    select.push(col('gm', 'ZWAGROUPMEMBER', 'ZCONTACTNAME', 'member_contact_name'));
  } else {
    missing.push('ZWAMESSAGE.ZGROUPMEMBER -> ZWAGROUPMEMBER.Z_PK (join)');
    select.push(`NULL AS member_jid`, `NULL AS member_contact_name`);
  }
  let mediaJoin: string | null = null;
  if (has('ZWAMESSAGE', 'ZMEDIAITEM') && has('ZWAMEDIAITEM', 'Z_PK')) mediaJoin = `mi.Z_PK = m.ZMEDIAITEM`;
  else if (has('ZWAMEDIAITEM', 'ZMESSAGE')) mediaJoin = `mi.ZMESSAGE = m.Z_PK`;
  if (mediaJoin) {
    joins.push(`LEFT JOIN ZWAMEDIAITEM mi ON ${mediaJoin}`);
    select.push(col('mi', 'ZWAMEDIAITEM', 'ZMEDIALOCALPATH', 'media_local_path'));
    select.push(col('mi', 'ZWAMEDIAITEM', 'ZFILESIZE', 'media_file_size'));
    select.push(col('mi', 'ZWAMEDIAITEM', 'ZTITLE', 'media_title'));
  } else {
    missing.push('ZWAMESSAGE.ZMEDIAITEM / ZWAMEDIAITEM.ZMESSAGE (join)');
    select.push(`NULL AS media_local_path`, `NULL AS media_file_size`, `NULL AS media_title`);
  }

  const cutoff = Date.now() / 1000 - APPLE_EPOCH_OFFSET_S - days * 86_400;
  const messageSql = `
    SELECT ${select.join(',\n           ')}
    FROM ZWAMESSAGE m
    JOIN ZWACHATSESSION s ON s.Z_PK = m.ZCHATSESSION
    ${joins.join('\n    ')}
    WHERE s.ZCONTACTJID LIKE '%@g.us' AND m.ZMESSAGEDATE >= ?
    ORDER BY m.ZMESSAGEDATE`;
  const rows = db.prepare(messageSql).all(cutoff);

  if (missing.length > 0) {
    console.warn(`\nWARNING: expected columns not found (exported as empty): ${[...new Set(missing)].join(', ')}`);
  }

  const headers = ['message_pk', 'stanza_id', 'group_jid', 'group_name', 'sent_at_utc', 'message_date_raw', 'is_from_me',
    'from_jid', 'member_jid', 'member_contact_name', 'push_name', 'message_type', 'group_event_type', 'text',
    'media_local_path', 'media_file_size', 'media_title'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const withDate: Record<string, SQLOutputValue> = { ...r, sent_at_utc: appleDateToIso(r.message_date_raw) };
    lines.push(headers.map((h) => csvField(withDate[h])).join(','));
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // BOM so Excel/Numbers open Gujarati text as UTF-8.
  fs.writeFileSync(outPath, '﻿' + lines.join('\r\n') + '\r\n', { encoding: 'utf8', mode: 0o600 });

  const byType = new Map<string, number>();
  const byGroup = new Map<string, number>();
  for (const r of rows) {
    byType.set(cell(r.message_type), (byType.get(cell(r.message_type)) ?? 0) + 1);
    const g = cell(r.group_name) || cell(r.group_jid);
    byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
  }
  console.log(`\n== Group messages, last ${days} days: ${rows.length} ==`);
  console.log(`by ZMESSAGETYPE: ${[...byType].map(([t, n]) => `${t || 'null'}=${n}`).join(', ') || 'none'}`);
  for (const [g, n] of [...byGroup].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${g}`);
  console.log(`\nCSV written: ${outPath}`);
  console.log('It contains private messages. Do not commit it; delete it when done.');
}

async function main(): Promise<void> {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--')),
      options: {
        db: { type: 'string' },
        days: { type: 'string', default: '7' },
        out: { type: 'string' },
        'keep-copy': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    process.exit(1);
  }
  // Help first: nothing below may touch the WhatsApp container.
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const days = Number(values.days);
  if (!Number.isFinite(days) || days <= 0) {
    console.error('error: --days must be a positive number');
    process.exit(1);
  }
  // pnpm runs scripts from the package dir; INIT_CWD is where the user ran pnpm.
  const userCwd = process.env.INIT_CWD ?? process.cwd();
  const dbPath = values.db ? path.resolve(userCwd, values.db) : DEFAULT_DB;
  const outPath = values.out
    ? path.resolve(userCwd, values.out)
    : path.resolve(import.meta.dirname, '..', 'out', `group-messages-last-${days}d.csv`);

  // Imported here so --help does not print node:sqlite's ExperimentalWarning.
  const { DatabaseSync } = await import('node:sqlite');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insider-probe-'));
  let db: DatabaseSync | undefined;
  try {
    console.log(`source  ${dbPath}\ncopy to ${tmpDir}`);
    const copy = copySnapshot(dbPath, tmpDir);
    db = new DatabaseSync(copy, { readOnly: true });
    probe(db, days, outPath);
  } catch (err) {
    if (err instanceof ProbeError) {
      console.error(`\nerror: ${err.message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    db?.close();
    if (values['keep-copy']) console.log(`temp copy kept: ${tmpDir} (contains private messages; delete it when done)`);
    else fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

await main();
