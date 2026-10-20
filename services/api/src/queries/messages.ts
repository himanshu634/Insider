/** Message search shared by the agent tools. No Hono here. */
import { and, desc, eq, gte, ilike, lt } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { waGroup, waMessage } from '../db/schema.js';
import { istDayEnd, istDayStart } from '../pipeline/schedule.js';

export const MAX_SEARCH_LIMIT = 20;

/**
 * A message for the agent tools: the sender is only a hash, and the group has no jid. The text and group name are
 * raw here; the search_messages tool masks phone numbers and mentions (agent/scrub.ts) before a model sees them.
 */
export interface MessageHit {
  id: number;
  group_id: number;
  group_name: string;
  sent_at: string;
  sender_hash: string;
  text: string | null;
}

/** Escape LIKE wildcards so "5%" and "_" match themselves. */
const literal = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/** Messages whose text contains `text` (any case), newest first. `from` and `to` are IST dates, both included. */
export async function searchMessages(
  db: Db,
  q: { text: string; from?: string; to?: string; limit: number },
): Promise<MessageHit[]> {
  const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(q.limit)));
  const rows = await db
    .select({
      id: waMessage.id,
      groupId: waMessage.groupId,
      groupName: waGroup.name,
      sentAt: waMessage.sentAt,
      senderHash: waMessage.senderHash,
      text: waMessage.text,
    })
    .from(waMessage)
    .innerJoin(waGroup, eq(waMessage.groupId, waGroup.id))
    .where(
      and(
        ilike(waMessage.text, `%${literal(q.text)}%`),
        q.from ? gte(waMessage.sentAt, istDayStart(q.from)) : undefined,
        q.to ? lt(waMessage.sentAt, istDayEnd(q.to)) : undefined,
      ),
    )
    .orderBy(desc(waMessage.sentAt), desc(waMessage.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    group_id: r.groupId,
    group_name: r.groupName,
    sent_at: r.sentAt.toISOString(),
    sender_hash: r.senderHash,
    text: r.text,
  }));
}
