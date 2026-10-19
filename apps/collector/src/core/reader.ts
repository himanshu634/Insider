import { DatabaseSync } from 'node:sqlite';
import { basename, extname } from 'node:path';
import { hashSender } from './sender-hash.js';
import {
  APPLE_EPOCH_OFFSET_SECONDS,
  CHAT_SESSION as S,
  FORWARDED_FLAG,
  GROUP_JID_SUFFIX,
  GROUP_MEMBER as GM,
  MEDIA_ITEM as MI,
  MESSAGE as M,
  MESSAGE_TYPE_MAP,
} from './whatsapp-schema.js';
import {
  MAX_ID_LENGTH,
  MAX_SENDER_NAME_LENGTH,
  MAX_TEXT_LENGTH,
  type CatalogGroup,
  type IngestMessage,
  type MediaMeta,
  type MessageType,
} from './types.js';

/** Last WhatsApp Z_PK read per group JID. A missing group means "from the beginning". */
export type Checkpoints = ReadonlyMap<string, number>;

export interface ReadMessage {
  groupJid: string;
  /** ZWAMESSAGE.Z_PK — local to this WhatsApp install, never uploaded. */
  pk: number;
  message: IngestMessage;
}

export interface ReadResult {
  messages: ReadMessage[];
  /**
   * Highest Z_PK seen per group in this read, including rows that were skipped (no stanza ID,
   * no date). Store these together with `messages` so skipped rows are not re-read forever.
   */
  checkpoints: Map<string, number>;
}

export interface ReaderOptions {
  /** Needed by newMessages(); groups() works without it. */
  senderHmacKey?: string;
  /** JID hashed for messages sent from this device (ZISFROMME = 1). */
  selfJid?: string;
}

export const DEFAULT_SELF_JID = 'self';
export const DEFAULT_READ_LIMIT = 5000;

interface MessageRow {
  pk: number;
  group_jid: string;
  stanza_id: string | null;
  text: string | null;
  message_date: number | null;
  message_type: number | null;
  is_from_me: number | null;
  flags: number | null;
  member_jid: string | null;
  member_name: string | null;
  media_item: number | null;
  media_path: string | null;
  media_size: number | null;
  quoted_stanza_id: string | null;
}

interface GroupRow {
  jid: string;
  name: string | null;
  member_count: number;
}

/** Core Data timestamp (seconds since 2001-01-01Z) → ISO 8601 UTC. */
export function appleTimeToIso(seconds: number): string {
  return new Date(Math.round((seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000)).toISOString();
}

export function mapMessageType(code: number | null): MessageType {
  if (code === null) return 'other';
  return MESSAGE_TYPE_MAP[code] ?? 'other';
}

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};

const MIME_BY_TYPE: Partial<Record<MessageType, string>> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/ogg',
  sticker: 'image/webp',
};

/** WhatsApp stores no MIME type we know of; guess from the file extension, then the message type. */
export function guessMime(path: string | null, type: MessageType): string {
  const byExt = path ? MIME_BY_EXT[extname(path).toLowerCase()] : undefined;
  return byExt ?? MIME_BY_TYPE[type] ?? 'application/octet-stream';
}

/** Cut to `max` UTF-16 units without leaving half a surrogate pair. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/** Read-only access to a ChatStorage snapshot. */
export class WhatsAppReader {
  private readonly selfJid: string;

  constructor(
    private readonly db: DatabaseSync,
    private readonly options: ReaderOptions = {},
  ) {
    this.selfJid = options.selfJid ?? DEFAULT_SELF_JID;
  }

  /** Open a snapshot copy read-only. Never point this at the live WhatsApp database. */
  static open(dbPath: string, options: ReaderOptions = {}): WhatsAppReader {
    return new WhatsAppReader(new DatabaseSync(dbPath, { readOnly: true }), options);
  }

  get database(): DatabaseSync {
    return this.db;
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  /** Every group chat (JID ends with @g.us); 1:1 chats are left out. */
  groups(): CatalogGroup[] {
    const sql = `
      SELECT s.${S.contactJid} AS jid,
             s.${S.partnerName} AS name,
             (SELECT COUNT(*) FROM ${GM.table} gm WHERE gm.${GM.chatSession} = s.${S.pk}) AS member_count
        FROM ${S.table} s
       WHERE s.${S.contactJid} LIKE '%' || ?
       ORDER BY s.${S.lastMessageDate} DESC`;
    const rows = this.db.prepare(sql).all(GROUP_JID_SUFFIX) as unknown as GroupRow[];
    return rows
      .filter((r) => r.jid.endsWith(GROUP_JID_SUFFIX))
      .map((r) => ({ jid: r.jid, name: r.name ?? r.jid, member_count: r.member_count }));
  }

  /**
   * Messages in `groupJids` with Z_PK above each group's checkpoint, oldest first, joined to the
   * sender (group member), media item and quoted message. Non-group JIDs are ignored.
   */
  newMessages(
    groupJids: readonly string[],
    checkpoints: Checkpoints,
    limit: number = DEFAULT_READ_LIMIT,
  ): ReadResult {
    const key = this.options.senderHmacKey;
    if (!key) throw new Error('newMessages needs senderHmacKey');
    const jids = [...new Set(groupJids)].filter((j) => j.endsWith(GROUP_JID_SUFFIX));
    const result: ReadResult = { messages: [], checkpoints: new Map() };
    if (jids.length === 0) return result;

    const where = jids.map(() => `(s.${S.contactJid} = ? AND m.${M.pk} > ?)`).join(' OR ');
    const params = jids.flatMap((j) => [j, checkpoints.get(j) ?? 0]);
    const sql = `
      SELECT m.${M.pk} AS pk,
             s.${S.contactJid} AS group_jid,
             m.${M.stanzaId} AS stanza_id,
             m.${M.text} AS text,
             m.${M.messageDate} AS message_date,
             m.${M.messageType} AS message_type,
             m.${M.isFromMe} AS is_from_me,
             m.${M.flags} AS flags,
             gm.${GM.memberJid} AS member_jid,
             gm.${GM.contactName} AS member_name,
             m.${M.mediaItem} AS media_item,
             mi.${MI.localPath} AS media_path,
             mi.${MI.fileSize} AS media_size,
             q.${M.stanzaId} AS quoted_stanza_id
        FROM ${M.table} m
        JOIN ${S.table} s ON s.${S.pk} = m.${M.chatSession}
        LEFT JOIN ${GM.table} gm ON gm.${GM.pk} = m.${M.groupMember}
        LEFT JOIN ${MI.table} mi ON mi.${MI.pk} = m.${M.mediaItem}
        LEFT JOIN ${M.table} q ON q.${M.pk} = m.${M.parentMessage}
       WHERE ${where}
       ORDER BY m.${M.pk}
       LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as unknown as MessageRow[];

    for (const row of rows) {
      const prev = result.checkpoints.get(row.group_jid) ?? 0;
      result.checkpoints.set(row.group_jid, Math.max(prev, row.pk));
      const message = this.toIngestMessage(row, key);
      if (message) result.messages.push({ groupJid: row.group_jid, pk: row.pk, message });
    }
    return result;
  }

  private toIngestMessage(row: MessageRow, senderHmacKey: string): IngestMessage | null {
    if (!row.stanza_id || row.stanza_id.length > MAX_ID_LENGTH) return null;
    if (row.message_date === null) return null;

    const type = mapMessageType(row.message_type);
    const fromMe = row.is_from_me === 1;
    // System events have no member; attribute them to the group itself.
    const senderJid = fromMe ? this.selfJid : (row.member_jid ?? row.group_jid);
    const senderName = fromMe ? null : row.member_name;

    let media: MediaMeta | null = null;
    if (row.media_item !== null) {
      media = {
        mime: guessMime(row.media_path, type),
        size_bytes: Math.max(0, row.media_size ?? 0),
        file_name: row.media_path ? basename(row.media_path) : null,
      };
    }

    const quoted = row.quoted_stanza_id;
    return {
      stanza_id: row.stanza_id,
      group_jid: row.group_jid,
      sender_hash: hashSender(senderJid, senderHmacKey),
      sender_name: senderName ? truncate(senderName, MAX_SENDER_NAME_LENGTH) : null,
      sent_at: appleTimeToIso(row.message_date),
      type,
      text: row.text === null ? null : truncate(row.text, MAX_TEXT_LENGTH),
      quoted_stanza_id: quoted && quoted.length <= MAX_ID_LENGTH ? quoted : null,
      is_forwarded: ((row.flags ?? 0) & FORWARDED_FLAG) !== 0,
      media,
    };
  }
}
