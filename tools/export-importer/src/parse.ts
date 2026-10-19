/**
 * Parser for WhatsApp "Export chat" .txt files.
 *
 * Two header shapes are recognised (one message per header, continuation
 * lines are appended to the previous message):
 *
 *   Android: `19/10/26, 9:41 am - Name: text`
 *   iOS:     `[19/10/26, 09:41:12] Name: text`
 *
 * Variants handled: 2- or 4-digit years, `/` `.` `-` date separators,
 * 12-hour (`am`, `AM`, `a.m.`, with a normal, no-break or narrow no-break
 * space) and 24-hour times, optional seconds, CRLF line endings, a BOM, and
 * the invisible bidi marks both platforms sprinkle into exports.
 *
 * System lines (encryption notice, "X added Y", subject changes, ...) and
 * deleted-message placeholders are skipped and counted.
 */

import type { components } from '@insider/contracts';

export type MessageType = components['schemas']['MessageType'];
export type DateFormat = 'dmy' | 'mdy';
export type ExportFormat = 'android' | 'ios';

/** Wall-clock time exactly as written in the export (no timezone). */
export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

export interface ParsedMessage {
  /** 1-based line number of the message header in the file. */
  line: number;
  format: ExportFormat;
  local: LocalDateTime;
  /** Sender display name (or phone number) with bidi marks removed. */
  sender: string;
  /** Full message body as exported (all lines joined with `\n`), bidi marks removed. */
  body: string;
  type: MessageType;
  /** Text to send as `text`: the body for text messages, the caption for media. */
  text: string | null;
  /** Attachment file name when the export names one. */
  attachment: string | null;
}

export interface ParseResult {
  messages: ParsedMessage[];
  /** System lines skipped (encryption notice, joins, subject changes, ...). */
  skippedSystem: number;
  /** "This message was deleted" placeholders skipped. */
  skippedDeleted: number;
  /** Non-empty lines before the first header (ignored). */
  skippedPreamble: number;
}

export interface ParseOptions {
  /** Order of day and month in the export's dates. Default `dmy`. */
  dateFormat?: DateFormat;
}

export class ExportParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
    this.name = 'ExportParseError';
  }
}

// BOM, LRM/RLM, LRE..RLO embeddings/overrides, LRI..PDI isolates.
const INVISIBLE = /[﻿‎‏‪-‮⁦-⁩]/g;
const LEADING_INVISIBLE = /^[﻿‎‏‪-‮⁦-⁩]+/;

export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE, '');
}

// date: d/m/y (any of / . -), time: h:mm[:ss] with optional am/pm marker.
const DATE = String.raw`(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})`;
const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:[\s  ]*([aApP])\.?[\s  ]?[mM]\.?)?`;
const IOS_HEADER = new RegExp(String.raw`^\[${DATE},?[\s  ]+${TIME}\][\s  ]?(.*)$`);
const ANDROID_HEADER = new RegExp(String.raw`^${DATE},?[\s  ]+${TIME}[\s  ]+[-–][\s  ](.*)$`);

const DELETED = /^(?:This message was deleted|You deleted this message)\.?$/i;
const EDITED_SUFFIX = /[\s ]*<This message was edited>$/i;

interface Header {
  format: ExportFormat;
  local: LocalDateTime;
  rest: string;
}

function parseHeader(line: string, dateFormat: DateFormat, lineNo: number): Header | null {
  const cleaned = line.replace(LEADING_INVISIBLE, '');
  let format: ExportFormat;
  let m = IOS_HEADER.exec(cleaned);
  if (m) {
    format = 'ios';
  } else {
    m = ANDROID_HEADER.exec(cleaned);
    if (!m) return null;
    format = 'android';
  }
  const [, a, b, c, hh, mm, ss, ampm, rest] = m as unknown as [
    string, string, string, string, string, string, string | undefined, string | undefined, string,
  ];

  let year: number;
  let month: number;
  let day: number;
  if (a.length === 4) {
    // ISO-ish yyyy-mm-dd, used by some locales regardless of --date-format.
    year = Number(a);
    month = Number(b);
    day = Number(c);
  } else {
    year = Number(c);
    if (c.length <= 2) year += 2000;
    [day, month] = dateFormat === 'dmy' ? [Number(a), Number(b)] : [Number(b), Number(a)];
  }

  let hour = Number(hh);
  const minute = Number(mm);
  const second = ss === undefined ? 0 : Number(ss);
  if (ampm !== undefined) {
    if (hour < 1 || hour > 12) throw new ExportParseError(`invalid 12-hour time "${hh}:${mm}"`, lineNo);
    const pm = ampm.toLowerCase() === 'p';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    const other = dateFormat === 'dmy' ? 'mdy' : 'dmy';
    throw new ExportParseError(
      `invalid date "${a}/${b}/${c}" for --date-format ${dateFormat} (try --date-format ${other})`,
      lineNo,
    );
  }
  if (hour > 23 || minute > 59 || second > 59) {
    throw new ExportParseError(`invalid time "${hh}:${mm}${ss ? ':' + ss : ''}"`, lineNo);
  }

  return { format, local: { year, month, day, hour, minute, second }, rest };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

interface Classified {
  type: MessageType;
  text: string | null;
  attachment: string | null;
}

const IOS_OMITTED: Record<string, MessageType> = {
  image: 'image',
  video: 'video',
  gif: 'video',
  audio: 'audio',
  sticker: 'sticker',
  document: 'document',
  'contact card': 'contact',
};

const EXTENSION_TYPES: Array<[RegExp, MessageType]> = [
  [/\.(jpe?g|png|heic|heif|bmp)$/i, 'image'],
  [/\.webp$/i, 'sticker'],
  [/\.(mp4|mov|3gp|mkv|gif)$/i, 'video'],
  [/\.(opus|ogg|m4a|mp3|aac|amr|wav)$/i, 'audio'],
  [/\.vcf$/i, 'contact'],
];

function typeFromFileName(name: string): MessageType {
  for (const [re, type] of EXTENSION_TYPES) if (re.test(name)) return type;
  return 'document'; // pdf, xlsx, docx, csv, zip, unknown files
}

function captionFrom(lines: string[]): string | null {
  const caption = lines.join('\n').trim();
  return caption === '' ? null : caption;
}

/** Work out the message type from the (already cleaned) body. */
function classify(body: string): Classified {
  const [first = '', ...more] = body.split('\n');
  const head = first.trim();

  if (/^<Media omitted>$/i.test(head)) {
    // Android export without media: the kind of media is not recorded.
    return { type: 'other', text: captionFrom(more), attachment: null };
  }
  const omitted = /^(image|video|gif|audio|sticker|document|contact card) omitted$/i.exec(head);
  if (omitted) {
    const type = IOS_OMITTED[omitted[1]!.toLowerCase()] ?? 'other';
    return { type, text: captionFrom(more), attachment: null };
  }
  const attached = /<attached: ([^>]+)>/.exec(head);
  if (attached) {
    const file = attached[1]!.trim();
    return { type: typeFromFileName(file), text: captionFrom(more), attachment: file };
  }
  const fileAttached = /^(.+?) \(file attached\)$/.exec(head);
  if (fileAttached) {
    const file = fileAttached[1]!.trim();
    return { type: typeFromFileName(file), text: captionFrom(more), attachment: file };
  }
  if (/^(?:location: )?https:\/\/maps\.google\.com\/\?q=\S+$/i.test(head) && more.length === 0) {
    return { type: 'location', text: head, attachment: null };
  }
  return { type: 'text', text: body, attachment: null };
}

interface Pending {
  line: number;
  format: ExportFormat;
  local: LocalDateTime;
  sender: string;
  lines: string[];
}

/**
 * Split the header remainder into sender and body. Returns null for a system
 * line. `bodyRaw` keeps leading invisible marks: iOS marks system text (which
 * it attributes to the group name) with a leading U+200E.
 */
function splitSender(rest: string, format: ExportFormat): { sender: string; bodyRaw: string } | null {
  const idx = rest.indexOf(': ');
  if (idx < 0) {
    // iOS writes "Name:" with nothing after it for some empty bodies.
    if (format === 'ios' && rest.endsWith(':')) return { sender: rest.slice(0, -1), bodyRaw: '' };
    return null; // Android system line: "<time> - Ramesh added Suresh"
  }
  const sender = stripInvisible(rest.slice(0, idx)).trim();
  const bodyRaw = rest.slice(idx + 2);
  // Subject/description changes contain ": " inside quotes, e.g.
  // `Ramesh changed the subject from "Bhav" to "Bhav: Unjha"`.
  if (sender === '' || /["“”]/.test(sender)) return null;
  return { sender, bodyRaw };
}

export function parseExport(input: string, options: ParseOptions = {}): ParseResult {
  const dateFormat = options.dateFormat ?? 'dmy';
  const lines = input.split(/\r?\n/);
  const messages: ParsedMessage[] = [];
  let skippedSystem = 0;
  let skippedDeleted = 0;
  let skippedPreamble = 0;

  let current: Pending | null = null;
  // True while continuation lines belong to a skipped system line.
  let inSkipped = false;

  const finish = (p: Pending): void => {
    const body = p.lines.join('\n').replace(EDITED_SUFFIX, '').trimEnd();
    if (DELETED.test(body.trim())) skippedDeleted++;
    else messages.push(toParsedMessage(p, body));
  };

  for (const [i, rawLine] of lines.entries()) {
    const lineNo = i + 1;
    const header = parseHeader(rawLine, dateFormat, lineNo);
    if (!header) {
      if (current) current.lines.push(stripInvisible(rawLine));
      else if (!inSkipped && stripInvisible(rawLine).trim() !== '') skippedPreamble++;
      continue;
    }

    if (current) finish(current);
    current = null;

    const split = splitSender(header.rest, header.format);
    const bodyClean = split ? stripInvisible(split.bodyRaw) : '';
    const iosSystem =
      split !== null &&
      header.format === 'ios' &&
      split.bodyRaw.startsWith('\u200E') &&
      classify(bodyClean).type === 'text';
    if (!split || iosSystem) {
      // Android: no "Name: " after the time. iOS: system text is credited to
      // the group name and starts with U+200E, e.g.
      // `[..] Group: \u200EMessages and calls are end-to-end encrypted.`
      skippedSystem++;
      inSkipped = true;
      continue;
    }
    inSkipped = false;
    current = {
      line: lineNo,
      format: header.format,
      local: header.local,
      sender: split.sender,
      lines: [bodyClean],
    };
  }
  if (current) finish(current);

  return { messages, skippedSystem, skippedDeleted, skippedPreamble };
}

function toParsedMessage(p: Pending, body: string): ParsedMessage {
  const { type, text, attachment } = classify(body);
  return {
    line: p.line,
    format: p.format,
    local: p.local,
    sender: p.sender,
    body,
    type,
    text,
    attachment,
  };
}
