import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  commodity,
  contentCluster,
  extractionEvent,
  llmCall,
  market,
  messageLabel,
  priceObservation,
  unit,
  waGroup,
  waMessage,
} from '../src/db/schema.js';
import { MAX_TOKENS } from '../src/extraction/extract.js';
import type { ExtractedRow, ExtractionOutput } from '../src/extraction/prompt.js';
import { contentHash } from '../src/pipeline/normalize-text.js';
import { pendingExtraction, processMessage } from '../src/pipeline/tasks.js';
import { senderHash } from '../src/security.js';
import { setup } from './helpers.js';
import { scriptedAnthropic, type ScriptedTurn, text } from './scripted-anthropic.js';

const row = (r: Partial<ExtractedRow>): ExtractedRow => ({
  kind: 'price',
  commodity: null,
  commodity_term: null,
  market: null,
  market_term: null,
  variety: null,
  obs_date: null,
  min_price: null,
  max_price: null,
  modal_price: null,
  change: null,
  unit_term: null,
  arrivals: null,
  arrivals_unit_term: null,
  evidence: '',
  ...r,
});

/** A model turn that returns `output` as structured JSON. */
const answer = (output: ExtractionOutput): ScriptedTurn => ({ content: [text(JSON.stringify(output))], stop_reason: 'end_turn' });

// 19 Oct 2026, 09:08 IST
const SENT_AT = new Date('2026-10-19T03:38:00Z');

describe('per-message extraction chain', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let groups: { g1: number; g3: number };

  beforeEach(async () => {
    t = await setup();
    const rows = await t.db
      .insert(waGroup)
      .values([
        { jid: 'g1@g.us', name: 'Gondal Castor Rates', isWatched: true, primaryCommodities: ['castor'] },
        { jid: 'g3@g.us', name: 'ગુજરાત મંડી ભાવ', isWatched: true, primaryCommodities: ['castor', 'groundnut'] },
      ])
      .returning({ id: waGroup.id });
    groups = { g1: rows[0]!.id, g3: rows[1]!.id };
  });
  afterEach(() => t.close());

  const add = async (
    groupId: number,
    stanzaId: string,
    body: string | null,
    more: Partial<typeof waMessage.$inferInsert> = {},
  ) => {
    const [m] = await t.db
      .insert(waMessage)
      .values({
        groupId,
        stanzaId,
        senderHash: 'h',
        senderName: 'Ramesh Bhai',
        sentAt: SENT_AT,
        type: 'text',
        text: body,
        contentHash: contentHash(body),
        ...more,
      })
      .returning({ id: waMessage.id });
    return m!.id;
  };

  const run = (messageId: number, client: Anthropic | null) =>
    processMessage({ db: t.db, anthropic: client, config: t.config }, { messageId });

  const observations = () => t.db.select().from(priceObservation).orderBy(priceObservation.id);

  it('labels noise by rule and skips non-text with no model call (FX-01, FX-13, FX-19)', async () => {
    const { client, requests } = scriptedAnthropic([]);
    const greeting = await add(groups.g1, 'G1-0001', 'જય શ્રી કૃષ્ણ 🙏 સુપ્રભાત');
    const sticker = await add(groups.g1, 'G1-0007', null, { type: 'sticker' });
    await run(greeting, client);
    await run(sticker, client);

    expect(requests).toHaveLength(0);
    const labels = await t.db.select().from(messageLabel);
    expect(labels.map((l) => [l.messageId, l.label, l.modelVersion])).toEqual([[greeting, 'noise', 'rule:v1']]);
  });

  it('stores a two-line rate list as two observations with their audit trail (FX-06)', async () => {
    const body = 'આજના ભાવ:\nએરંડા 1260-1295 ડીસા\nમગફળી જાડી 1120-1210 જૂનાગઢ';
    const id = await add(groups.g3, 'G3-0001', body);
    const { client, requests } = scriptedAnthropic([
      answer({
        label: 'price',
        rows: [
          row({ commodity: 'castor', commodity_term: 'એરંડા', market: 'deesa', market_term: 'ડીસા', min_price: 1260, max_price: 1295, evidence: 'એરંડા 1260-1295 ડીસા' }),
          row({ commodity: 'groundnut', commodity_term: 'મગફળી', variety: 'જાડી', market: 'junagadh', market_term: 'જૂનાગઢ', min_price: 1120, max_price: 1210, evidence: 'મગફળી જાડી 1120-1210 જૂનાગઢ' }),
        ],
      }),
    ]);
    await run(id, client);

    expect(requests).toHaveLength(1);
    const obs = await observations();
    expect(obs.map((o) => [o.minPerQuintal, o.maxPerQuintal, o.variety, o.obsDate, o.status])).toEqual([
      [6300, 6475, null, '2026-10-19', 'auto'],
      [5600, 6050, 'જાડી', '2026-10-19', 'auto'],
    ]);
    const [label] = await t.db.select().from(messageLabel);
    expect(label).toMatchObject({ label: 'price', modelVersion: 'claude-opus-5-5:extract-v1' });

    const [call] = await t.db.select().from(llmCall);
    expect(call).toMatchObject({ messageId: id, purpose: 'extract', outcome: 'ok', promptVersion: 'extract-v1', notes: [] });
    expect(call!.request).toEqual(requests[0]);
    const events = await t.db.select().from(extractionEvent);
    expect(events).toHaveLength(2);
    expect(events[0]!.after).toMatchObject({ evidence: 'એરંડા 1260-1295 ડીસા', llm_call_id: call!.id });
    expect(events[0]!.actor).toBe('model:claude-opus-5-5:extract-v1');
  });

  it('sends the model no sender, phone number or price reference (SF-03, CX-08)', async () => {
    // Three trusted castor prices at Gondal around ₹6,300/q in the days before.
    const [castor] = await t.db.select().from(commodity).where(eq(commodity.slug, 'castor'));
    const [gondal] = await t.db.select().from(market).where(eq(market.slug, 'gondal'));
    const [quintal] = await t.db.select().from(unit).where(eq(unit.code, 'per_quintal'));
    const seed = await add(groups.g1, 'SEED', 'seed');
    await t.db.insert(priceObservation).values(
      ['2026-10-16', '2026-10-17', '2026-10-18'].map((obsDate) => ({
        messageId: seed,
        commodityId: castor!.id,
        marketId: gondal!.id,
        unitId: quintal!.id,
        obsDate,
        modalRaw: 6300,
        modalPerQuintal: 6300,
        confidence: 1,
      })),
    );

    const body = 'એરંડા 12550 ગોંડલ, call 98765 43210 @919812345678';
    const id = await add(groups.g1, 'G1-0099', body, { quotedStanzaId: 'SEED' });
    const { client, requests } = scriptedAnthropic([
      answer({
        label: 'price',
        rows: [row({ commodity: 'castor', commodity_term: 'એરંડા', market: 'gondal', market_term: 'ગોંડલ', modal_price: 12550, evidence: 'એરંડા 12550 ગોંડલ' })],
      }),
    ]);
    await run(id, client);

    const sent = JSON.stringify(requests[0]);
    expect(sent).not.toContain('Ramesh');
    expect(sent).not.toContain('98765');
    expect(sent).not.toContain('919812345678');
    expect(sent).not.toContain('6300');
    expect(sent).toContain('[phone]');
    expect(sent).toContain('<quoted_message>');

    // ₹62,750/q against a ₹6,300 median: review, out of bounds (EX-11).
    const [obs] = (await observations()).filter((o) => o.messageId === id);
    expect(obs).toMatchObject({ modalPerQuintal: 62750, status: 'needs_review' });
    const [event] = await t.db.select().from(extractionEvent).where(eq(extractionEvent.observationId, obs!.id));
    expect((event!.after as { reasons: string[] }).reasons).toContain('out_of_bounds');
  });

  it('records dropped rows on the call and stores the rest', async () => {
    const id = await add(groups.g3, 'G3-0010', 'Gondal 1260-1288, Jeeru 4200 Unjha');
    const { client } = scriptedAnthropic([
      answer({
        label: 'price',
        rows: [
          row({ market: 'gondal', market_term: 'Gondal', min_price: 1260, max_price: 1288, evidence: 'Gondal 1260-1288' }),
          row({ commodity_term: 'Jeeru', market_term: 'Unjha', modal_price: 4200, evidence: 'Jeeru 4200 Unjha' }),
        ],
      }),
    ]);
    await run(id, client);
    expect(await observations()).toHaveLength(0);
    const [call] = await t.db.select().from(llmCall);
    expect(call!.notes).toEqual(['row 1: ambiguous_commodity', 'row 2: unknown_commodity Jeeru']);
    expect(await t.db.select().from(messageLabel)).toHaveLength(1);
  });

  it('stores nothing on a refusal (SF-04)', async () => {
    const id = await add(groups.g1, 'G1-0002', 'એરંડા 1250-1290 ગોંડલ');
    const { client, requests } = scriptedAnthropic([{ content: [], stop_reason: 'refusal' }]);
    await run(id, client);
    expect(requests).toHaveLength(1);
    expect(await observations()).toHaveLength(0);
    expect(await t.db.select().from(messageLabel)).toHaveLength(0);
    expect((await t.db.select().from(llmCall))[0]!.outcome).toBe('refusal');
    // A refused message is not picked up again by extract-pending.
    expect(await pendingExtraction(t.db, 10)).toEqual([]);
  });

  it('retries a cut-off answer once with a higher limit, then gives up (SF-06)', async () => {
    const id = await add(groups.g1, 'G1-0003', 'એરંડા 1250-1290 ગોંડલ');
    const cut = { content: [text('{"label":"price","rows":[')], stop_reason: 'max_tokens' };
    const { client, requests } = scriptedAnthropic([cut, cut]);
    await run(id, client);
    expect(requests.map((r) => r.max_tokens)).toEqual([...MAX_TOKENS]);
    expect(await observations()).toHaveLength(0);
    expect((await t.db.select().from(llmCall)).map((c) => c.outcome)).toEqual(['max_tokens', 'max_tokens']);
  });

  it('stores nothing when the output does not fit the schema', async () => {
    const id = await add(groups.g1, 'G1-0004', 'એરંડા 1250-1290 ગોંડલ');
    const { client } = scriptedAnthropic([{ content: [text('{"rows": "none"}')], stop_reason: 'end_turn' }]);
    await run(id, client);
    expect((await t.db.select().from(llmCall))[0]!.outcome).toBe('invalid_output');
    expect(await observations()).toHaveLength(0);
  });

  it('waits without a key, then runs once from extract-pending, and never twice', async () => {
    const body = 'એરંડા 1250-1290 ગોંડલ';
    const id = await add(groups.g1, 'G1-0005', body);
    await run(id, null);
    expect(await t.db.select().from(messageLabel)).toHaveLength(0);
    expect(await pendingExtraction(t.db, 10)).toEqual([id]);

    const { client, requests } = scriptedAnthropic([
      answer({
        label: 'price',
        rows: [row({ commodity: 'castor', commodity_term: 'એરંડા', market: 'gondal', market_term: 'ગોંડલ', min_price: 1250, max_price: 1290, evidence: body })],
      }),
    ]);
    await run(id, client);
    // A retried job: the scripted client has no second turn, so a second call would throw.
    await run(id, client);
    expect(requests).toHaveLength(1);
    expect(await observations()).toHaveLength(1);
    expect(await pendingExtraction(t.db, 10)).toEqual([]);
  });

  it('counts a forward once when its job runs again (FX-10)', async () => {
    const body = 'Castor Gujarat average 1270, market steady';
    const first = await add(groups.g1, 'G1-0006', body);
    const forward = await add(groups.g3, 'G3-0002', body);
    const { client } = scriptedAnthropic([answer({ label: 'news', rows: [] })]);
    await run(first, client);
    await run(forward, client);
    await run(forward, client);
    const [cluster] = await t.db.select().from(contentCluster);
    expect(cluster).toMatchObject({ groupCount: 2, canonicalMessageId: first });
    expect((await t.db.select().from(messageLabel)).map((l) => l.messageId)).toEqual([first]);
  });

  it('runs on ingest through the inline queue', async () => {
    await t.close();
    const body = 'singdana bold 1100-1180 per 20kg Rajkot';
    const { client } = scriptedAnthropic([
      answer({
        label: 'price',
        rows: [row({ commodity: 'groundnut', commodity_term: 'singdana', variety: 'bold', market: 'rajkot', market_term: 'Rajkot', min_price: 1100, max_price: 1180, unit_term: 'per 20kg', evidence: body })],
      }),
    ]);
    t = await setup({ anthropic: client });
    const res = await t.request('/v1/ingest/messages', {
      method: 'POST',
      json: {
        messages: [
          { stanza_id: 'G2-0002', group_jid: 'g2@g.us', sender_hash: senderHash('919800000001@s.whatsapp.net', 'k'), sent_at: SENT_AT.toISOString(), type: 'text', text: body, is_forwarded: false },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect((await observations()).map((o) => [o.minPerQuintal, o.maxPerQuintal])).toEqual([[5500, 5900]]);
  });
});

describe('review edits', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => (t = await setup()));
  afterEach(() => t.close());

  it('recomputes per-quintal prices from edited raw values and unit', async () => {
    const [group] = await t.db.insert(waGroup).values({ jid: 'g@g.us', name: 'G' }).returning();
    const [m] = await t.db
      .insert(waMessage)
      .values({ groupId: group!.id, stanzaId: 'S', senderHash: 'h', sentAt: SENT_AT, type: 'text', text: 'x' })
      .returning();
    const [castor] = await t.db.select().from(commodity).where(eq(commodity.slug, 'castor'));
    const [gondal] = await t.db.select().from(market).where(eq(market.slug, 'gondal'));
    const [per20] = await t.db.select().from(unit).where(eq(unit.code, 'per_20kg'));
    const [obs] = await t.db
      .insert(priceObservation)
      .values({
        messageId: m!.id,
        commodityId: castor!.id,
        marketId: gondal!.id,
        unitId: per20!.id,
        obsDate: '2026-10-19',
        minRaw: 1290,
        maxRaw: 1250,
        minPerQuintal: 6450,
        maxPerQuintal: 6250,
        confidence: 1,
        status: 'needs_review',
      })
      .returning();

    const res = await t.request('/v1/review/observations', {
      method: 'PATCH',
      device: false,
      json: { id: obs!.id, action: 'edit', changes: { min_raw: 1250, max_raw: 1290 } },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ min_per_quintal: 6250, max_per_quintal: 6450, status: 'approved' });

    const perQuintal = await t.request('/v1/review/observations', {
      method: 'PATCH',
      device: false,
      json: { id: obs!.id, action: 'edit', changes: { unit: 'per_quintal' } },
    });
    expect(await perQuintal.json()).toMatchObject({ min_per_quintal: 1250, max_per_quintal: 1290 });
  });
});
