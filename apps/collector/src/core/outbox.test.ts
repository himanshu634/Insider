import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDirs } from '../test-support/fixture.js';
import { localDay, Outbox } from './outbox.js';
import type { IngestMessage, MessageType } from './types.js';

const G1 = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';

function media(stanza: string, type: MessageType, group = G1): IngestMessage {
  return { ...msg(stanza, group), type, media: { mime: 'image/jpeg', size_bytes: 1, file_name: null } };
}

function msg(stanza: string, group = G1): IngestMessage {
  return {
    stanza_id: stanza,
    group_jid: group,
    sender_hash: 'a'.repeat(64),
    sender_name: 'Test',
    sent_at: '2026-10-19T03:30:00.000Z',
    type: 'text',
    text: `text ${stanza}`,
    quoted_stanza_id: null,
    is_forwarded: false,
    media: null,
  };
}

const open: Outbox[] = [];
function openOutbox(path = join(makeTempDir(), 'outbox.sqlite')): Outbox {
  const o = Outbox.open(path);
  open.push(o);
  return o;
}

afterEach(() => {
  for (const o of open.splice(0)) o.close();
});
afterAll(removeTempDirs);

describe('Outbox', () => {
  it('enqueues messages and advances checkpoints together', () => {
    const o = openOutbox();
    const added = o.enqueue(
      [{ groupJid: G1, message: msg('s1') }, { groupJid: G2, message: msg('s2', G2) }],
      new Map([[G1, 10], [G2, 20]]),
    );
    expect(added).toBe(2);
    expect(o.size()).toBe(2);
    expect(o.checkpoints()).toEqual(new Map([[G1, 10], [G2, 20]]));
  });

  it('ignores duplicates and never moves a checkpoint backwards', () => {
    const o = openOutbox();
    o.enqueue([{ groupJid: G1, message: msg('s1') }], new Map([[G1, 10]]));
    const added = o.enqueue([{ groupJid: G1, message: msg('s1') }], new Map([[G1, 5]]));
    expect(added).toBe(0);
    expect(o.size()).toBe(1);
    expect(o.checkpoints().get(G1)).toBe(10);
  });

  it('rolls back messages and checkpoints if anything in the enqueue fails', () => {
    const o = openOutbox();
    o.enqueue([{ groupJid: G1, message: msg('s0') }], new Map([[G1, 1]]));
    const bad = { ...msg('s2'), text: 1n as unknown as string }; // JSON.stringify throws on BigInt
    expect(() =>
      o.enqueue(
        [{ groupJid: G1, message: msg('s1') }, { groupJid: G1, message: bad }],
        new Map([[G1, 99]]),
      ),
    ).toThrow();
    expect(o.size()).toBe(1);
    expect(o.checkpoints().get(G1)).toBe(1);
    // Still usable afterwards.
    expect(o.enqueue([{ groupJid: G1, message: msg('s1') }], new Map([[G1, 2]]))).toBe(1);
  });

  it('hands out batches oldest first, capped at 500', () => {
    const o = openOutbox();
    const items = Array.from({ length: 1200 }, (_, i) => ({ groupJid: G1, message: msg(`s${i}`) }));
    o.enqueue(items, new Map([[G1, 1200]]));
    const first = o.nextBatch(10_000);
    expect(first).toHaveLength(500);
    expect(first[0]?.message.stanza_id).toBe('s0');
    expect(o.nextBatch(3).map((b) => b.message.stanza_id)).toEqual(['s0', 's1', 's2']);
    o.markSent(first.map((b) => b.id));
    expect(o.nextBatch()[0]?.message.stanza_id).toBe('s500');
    o.markSent(o.nextBatch().map((b) => b.id));
    expect(o.nextBatch()).toHaveLength(200);
    expect(o.size()).toBe(200);
  });

  it('returns the stored message unchanged', () => {
    const o = openOutbox();
    const m = { ...msg('s1'), text: 'એરંડા 1250-1290 ગોંડલ', media: { mime: 'image/jpeg', size_bytes: 1, file_name: null } };
    o.enqueue([{ groupJid: G1, message: m }], new Map());
    expect(o.nextBatch()[0]?.message).toEqual(m);
  });

  it('markSent removes messages and counts them per day', () => {
    const o = openOutbox();
    o.enqueue([1, 2, 3].map((i) => ({ groupJid: G1, message: msg(`s${i}`) })), new Map());
    const ids = o.nextBatch().map((b) => b.id);
    const day = new Date(2026, 9, 19, 12);
    o.markSent(ids.slice(0, 2), day);
    o.markSent(ids.slice(0, 2), day); // already gone: not counted twice
    expect(o.size()).toBe(1);
    expect(o.sentOn(localDay(day))).toBe(2);
    expect(o.sentOn('2026-10-18')).toBe(0);
  });

  it('markRejected moves messages out of the queue', () => {
    const o = openOutbox();
    o.enqueue([{ groupJid: G1, message: msg('s1') }], new Map());
    const [item] = o.nextBatch();
    o.markRejected([{ id: item!.id, error: 'bad' }]);
    expect(o.size()).toBe(0);
    expect(o.rejectedCount()).toBe(1);
  });

  it('survives closing and reopening the file', () => {
    const path = join(makeTempDir(), 'outbox.sqlite');
    const a = Outbox.open(path);
    a.enqueue([{ groupJid: G1, message: msg('s1') }], new Map([[G1, 7]]));
    a.markSent([], new Date());
    a.close();
    const b = openOutbox(path);
    expect(b.size()).toBe(1);
    expect(b.checkpoints()).toEqual(new Map([[G1, 7]]));
    expect(b.nextBatch()[0]?.message.stanza_id).toBe('s1');
  });

  it('records image and document media as pending in the same transaction as the checkpoint', () => {
    const o = openOutbox();
    o.enqueue(
      [
        { groupJid: G1, message: media('img', 'image'), media: { itemPk: 1, localPath: null } },
        { groupJid: G1, message: media('doc', 'document'), media: { itemPk: 2, localPath: 'Media/x/rates.pdf' } },
        { groupJid: G1, message: media('voice', 'audio'), media: { itemPk: 3, localPath: 'Media/x/a.opus' } },
        { groupJid: G1, message: media('stk', 'sticker'), media: { itemPk: 4, localPath: 'Media/x/s.webp' } },
        { groupJid: G1, message: msg('txt') },
      ],
      new Map([[G1, 50]]),
    );
    expect(o.media.pending().map((p) => [p.stanzaId, p.type, p.itemPk, p.localPath])).toEqual([
      ['img', 'image', 1, null],
      ['doc', 'document', 2, 'Media/x/rates.pdf'],
    ]);
    expect(o.media.pendingItemPksWithoutPath()).toEqual([1]);
    expect(o.media.waitingCount()).toBe(2);
  });

  it('rolls back pending media with the rest of a failed enqueue', () => {
    const o = openOutbox();
    const bad = { ...msg('s2'), text: 1n as unknown as string };
    expect(() =>
      o.enqueue(
        [
          { groupJid: G1, message: media('img', 'image'), media: { itemPk: 1, localPath: null } },
          { groupJid: G1, message: bad },
        ],
        new Map([[G1, 99]]),
      ),
    ).toThrow();
    expect(o.media.waitingCount()).toBe(0);
    expect(o.checkpoints().size).toBe(0);
  });

  it('fills in a pending path once and keeps it across reopening', () => {
    const path = join(makeTempDir(), 'outbox.sqlite');
    const a = Outbox.open(path);
    a.enqueue([{ groupJid: G1, message: media('img', 'image'), media: { itemPk: 7, localPath: null } }], new Map());
    a.media.updatePendingPaths(new Map([[7, null]]));
    expect(a.media.pendingItemPksWithoutPath()).toEqual([7]);
    a.media.updatePendingPaths(new Map([[7, 'Media/x/1.jpg']]));
    a.media.updatePendingPaths(new Map([[7, 'Media/x/other.jpg']]));
    a.close();
    const b = openOutbox(path);
    expect(b.media.pending()[0]?.localPath).toBe('Media/x/1.jpg');
    expect(b.media.pendingItemPksWithoutPath()).toEqual([]);
  });

  it('markRejected gives up the media of rejected messages', () => {
    const o = openOutbox();
    o.enqueue(
      [
        { groupJid: G1, message: media('bad', 'image'), media: { itemPk: 1, localPath: null } },
        { groupJid: G1, message: media('ok', 'image'), media: { itemPk: 2, localPath: null } },
      ],
      new Map(),
    );
    const [bad] = o.nextBatch();
    o.markRejected([{ id: bad!.id, error: 'bad' }], new Date('2026-10-19T06:00:00Z'));
    expect(o.media.pending().map((p) => p.stanzaId)).toEqual(['ok']);
    expect(o.media.failed()).toEqual([
      { groupJid: G1, stanzaId: 'bad', path: null, reason: 'message rejected', failedAt: '2026-10-19T06:00:00.000Z' },
    ]);
  });

  it('adds the media tables to a version 1 outbox file', () => {
    const path = join(makeTempDir(), 'outbox.sqlite');
    const v1 = new DatabaseSync(path);
    v1.exec(`CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, group_jid TEXT NOT NULL,
               stanza_id TEXT NOT NULL, payload TEXT NOT NULL, enqueued_at TEXT NOT NULL, UNIQUE (group_jid, stanza_id));
             INSERT INTO outbox (group_jid, stanza_id, payload, enqueued_at) VALUES ('${G1}', 's1', '${JSON.stringify(msg('s1'))}', 'x');
             PRAGMA user_version = 1;`);
    v1.close();
    const o = openOutbox(path);
    expect(o.size()).toBe(1);
    expect(o.media.waitingCount()).toBe(0);
    o.enqueue([{ groupJid: G1, message: media('img', 'image'), media: { itemPk: 1, localPath: null } }], new Map());
    expect(o.media.waitingCount()).toBe(1);
  });

  it('localDay formats the local date', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
