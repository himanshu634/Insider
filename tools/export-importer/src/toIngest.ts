/**
 * Turn parsed export messages into `IngestMessage` objects for
 * `POST /v1/ingest/messages`.
 *
 * Exports have no stanza IDs and no sender JIDs, so both are derived:
 *
 * - `stanza_id` = "export-" + sha1(group_jid, sent_at, sender, body), fields
 *   joined with U+0000, `sent_at` being the UTC ISO string sent to the API.
 *   Re-importing the same file (or an overlapping later export) yields the
 *   same IDs, so the API reports the overlap as duplicates. Two identical
 *   messages from the same sender in the same minute collide (Android
 *   exports have no seconds) and the second is reported as a duplicate.
 * - `sender_hash` = HMAC-SHA256(SENDER_HMAC_KEY, display name). The collector
 *   hashes the JID instead, so the same person gets a different hash from an
 *   export than from the collector. When the export shows a phone number
 *   instead of a name, the hash input is `<digits>@s.whatsapp.net` (a guess
 *   at the collector's JID form) and `sender_name` is null, so phone numbers
 *   never reach the server in clear.
 */

import { createHash, createHmac } from 'node:crypto';
import type { components } from '@insider/contracts';
import type { LocalDateTime, ParsedMessage } from './parse.js';

export type IngestMessage = components['schemas']['IngestMessage'];

/** Fixed UTC offsets in minutes. India has no DST, so a table is exact. */
export const TZ_OFFSET_MINUTES: Readonly<Record<string, number>> = {
  'Asia/Kolkata': 330,
  'Asia/Calcutta': 330,
  UTC: 0,
  'Etc/UTC': 0,
};

export const GROUP_JID_PATTERN = /@g\.us$/;
const MAX_TEXT = 65536;
const MAX_SENDER_NAME = 256;

export function tzOffsetMinutes(tz: string): number {
  const offset = TZ_OFFSET_MINUTES[tz];
  if (offset === undefined) {
    throw new Error(`unsupported --tz "${tz}" (supported: ${Object.keys(TZ_OFFSET_MINUTES).join(', ')})`);
  }
  return offset;
}

/** Local wall-clock time + fixed offset -> UTC ISO string (`...Z`). */
export function localToUtcIso(local: LocalDateTime, offsetMinutes: number): string {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return new Date(asUtc - offsetMinutes * 60_000).toISOString();
}

export function hmacHex(key: string, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

export function exportStanzaId(groupJid: string, sentAtIso: string, sender: string, body: string): string {
  const digest = createHash('sha1').update([groupJid, sentAtIso, sender, body].join('\u0000'), 'utf8').digest('hex');
  return `export-${digest}`;
}

const PHONE = /^\+?[\d\s\-().]+$/;

/** Returns the digits when the "name" is really a phone number, else null. */
export function phoneDigits(sender: string): string | null {
  if (!PHONE.test(sender)) return null;
  const digits = sender.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

export function senderIdentity(rawSender: string, hmacKey: string): { sender_hash: string; sender_name: string | null } {
  const sender = rawSender.normalize('NFC').trim();
  const digits = phoneDigits(sender);
  if (digits) return { sender_hash: hmacHex(hmacKey, `${digits}@s.whatsapp.net`), sender_name: null };
  return { sender_hash: hmacHex(hmacKey, sender), sender_name: sender.slice(0, MAX_SENDER_NAME) };
}

export interface ToIngestOptions {
  groupJid: string;
  hmacKey: string;
  /** IANA name from TZ_OFFSET_MINUTES. Default `Asia/Kolkata`. */
  tz?: string;
}

export function toIngest(messages: readonly ParsedMessage[], options: ToIngestOptions): IngestMessage[] {
  const { groupJid, hmacKey } = options;
  if (!GROUP_JID_PATTERN.test(groupJid)) throw new Error(`group JID must end with @g.us, got "${groupJid}"`);
  if (!hmacKey) throw new Error('HMAC key is empty');
  const offset = tzOffsetMinutes(options.tz ?? 'Asia/Kolkata');

  return messages.map((m) => {
    const sentAt = localToUtcIso(m.local, offset);
    const sender = m.sender.normalize('NFC').trim();
    return {
      stanza_id: exportStanzaId(groupJid, sentAt, sender, m.body),
      group_jid: groupJid,
      ...senderIdentity(sender, hmacKey),
      sent_at: sentAt,
      type: m.type,
      text: m.text === null ? null : m.text.slice(0, MAX_TEXT),
      quoted_stanza_id: null,
      is_forwarded: false,
      // MediaMeta needs size_bytes, which an export does not record, and this
      // tool does not upload files, so media metadata is left out.
      media: null,
    };
  });
}

export const MAX_BATCH = 500;

export function chunk<T>(items: readonly T[], size = MAX_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
