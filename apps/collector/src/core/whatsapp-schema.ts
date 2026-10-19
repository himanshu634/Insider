/**
 * Every WhatsApp Desktop (macOS) table and column name the collector uses lives in this file.
 *
 * UNCONFIRMED until Phase 0. The names come from public tools that read iOS/macOS
 * ChatStorage.sqlite (Core Data store: Z_PK primary keys, Z-prefixed columns). Phase 0 checks
 * them against a real database; if anything differs, fix it here (and in
 * packages/fixtures/chatstorage/synthetic.sql) and nowhere else.
 */

import type { MessageType } from './types.js';

export const CHAT_SESSION = {
  table: 'ZWACHATSESSION',
  pk: 'Z_PK',
  /** `<id>@g.us` for groups, `<number>@s.whatsapp.net` for 1:1 chats. */
  contactJid: 'ZCONTACTJID',
  /** Group subject or contact name. */
  partnerName: 'ZPARTNERNAME',
  lastMessageDate: 'ZLASTMESSAGEDATE',
} as const;

export const MESSAGE = {
  table: 'ZWAMESSAGE',
  pk: 'Z_PK',
  /** FK → ZWACHATSESSION.Z_PK */
  chatSession: 'ZCHATSESSION',
  /** Message body, or the caption of a media message. */
  text: 'ZTEXT',
  /** Seconds since 2001-01-01T00:00:00Z (Apple / Core Data epoch), REAL. */
  messageDate: 'ZMESSAGEDATE',
  messageType: 'ZMESSAGETYPE',
  stanzaId: 'ZSTANZAID',
  isFromMe: 'ZISFROMME',
  /** FK → ZWAGROUPMEMBER.Z_PK (sender in a group; NULL for own messages). */
  groupMember: 'ZGROUPMEMBER',
  /** FK → ZWAMEDIAITEM.Z_PK */
  mediaItem: 'ZMEDIAITEM',
  /** FK → ZWAMESSAGE.Z_PK of the quoted message (reply-to). Guessed. */
  parentMessage: 'ZPARENTMESSAGE',
  /** Bit field; see FORWARDED_FLAG. Guessed. */
  flags: 'ZFLAGS',
} as const;

export const GROUP_MEMBER = {
  table: 'ZWAGROUPMEMBER',
  pk: 'Z_PK',
  /** FK → ZWACHATSESSION.Z_PK */
  chatSession: 'ZCHATSESSION',
  memberJid: 'ZMEMBERJID',
  contactName: 'ZCONTACTNAME',
} as const;

export const MEDIA_ITEM = {
  table: 'ZWAMEDIAITEM',
  pk: 'Z_PK',
  /** Path relative to the WhatsApp shared container; NULL until the file has downloaded. */
  localPath: 'ZMEDIALOCALPATH',
  fileSize: 'ZFILESIZE',
} as const;

export const WHATSAPP_TABLES = [CHAT_SESSION, MESSAGE, GROUP_MEMBER, MEDIA_ITEM] as const;

/** Every `table.column` the reader touches. The schema guard checks exactly these. */
export const REQUIRED_COLUMNS: readonly string[] = WHATSAPP_TABLES.flatMap((t) =>
  Object.entries(t)
    .filter(([key]) => key !== 'table')
    .map(([, column]) => `${t.table}.${column}`),
);

/**
 * Folders, relative to the folder that holds ChatStorage.sqlite, that ZMEDIALOCALPATH may be
 * relative to, tried in order. UNCONFIRMED until Phase 0: public macOS tools resolve it against
 * `Message/` in the shared container; the dev fixture keeps files next to the database.
 */
export const MEDIA_ROOTS_FROM_DB_DIR: readonly string[] = ['Message', '.'];

/** Group chat JIDs end with this suffix. */
export const GROUP_JID_SUFFIX = '@g.us';

/** Seconds between 1970-01-01 and 2001-01-01 (UTC). */
export const APPLE_EPOCH_OFFSET_SECONDS = 978_307_200;

/** ZFLAGS bit that marks a forwarded message. GUESSED; confirm in Phase 0. */
export const FORWARDED_FLAG = 0x100;

/**
 * ZMESSAGETYPE → contract MessageType. GUESSED from public iOS export tools; confirm in Phase 0.
 *   0 text · 1 image · 2 video · 3 audio/voice note · 4 contact card · 5 location ·
 *   6 group event (system) · 7 text with link preview · 8 document · 10 security notice (system) ·
 *   11 GIF (sent as video) · 14 deleted message (system) · 15 sticker.
 * Anything else maps to `other`.
 */
export const MESSAGE_TYPE_MAP: Readonly<Record<number, MessageType>> = {
  0: 'text',
  1: 'image',
  2: 'video',
  3: 'audio',
  4: 'contact',
  5: 'location',
  6: 'system',
  7: 'text',
  8: 'document',
  10: 'system',
  11: 'video',
  14: 'system',
  15: 'sticker',
};
