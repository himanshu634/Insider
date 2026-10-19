import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDirs } from '../test-support/fixture.js';
import { localDay, Outbox } from './outbox.js';
import type { IngestMessage } from './types.js';

const G1 = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';

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

  it('localDay formats the local date', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
