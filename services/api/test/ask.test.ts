import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';

import { ask } from '../src/agent/ask.js';
import { marketTools } from '../src/agent/index.js';
import { loadConfig } from '../src/config.js';
import { commodity, dailyPrice, market, waGroup, waMessage } from '../src/db/schema.js';
import { scriptedAnthropic, text, toolUse } from './scripted-anthropic.js';
import { setup } from './helpers.js';

// loadConfig({}) ignores INSIDER_AGENT_MODEL and friends in the developer's shell.
const config = loadConfig({});

describe('ask', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let messageId: number;

  beforeEach(async () => {
    t = await setup();
    const [castor] = await t.db.select().from(commodity).where(eq(commodity.slug, 'castor'));
    const [gondal] = await t.db.select().from(market).where(eq(market.slug, 'gondal'));
    await t.db.insert(dailyPrice).values({
      commodityId: castor!.id,
      marketId: gondal!.id,
      qualityFlag: 'ok',
      date: '2026-10-19',
      medianModal: 6300,
      min: 6260,
      max: 6340,
      sourceCount: 3,
      groupCount: 2,
    });
    const [group] = await t.db
      .insert(waGroup)
      .values({ jid: '120363@g.us', name: 'Gondal Castor Rates', isWatched: true })
      .returning({ id: waGroup.id });
    const [message] = await t.db
      .insert(waMessage)
      .values({
        groupId: group!.id,
        stanzaId: 'm1',
        senderHash: 'hash-1',
        senderName: 'Ramesh Patel',
        sentAt: new Date('2026-10-19T06:00:00Z'),
        type: 'text',
        text: 'Gondal arenda 1260-1288',
      })
      .returning({ id: waMessage.id });
    messageId = message!.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await t.close();
  });

  it('answers from a tool result and builds the request correctly', async () => {
    const { client, requests, headers } = scriptedAnthropic([
      { content: [toolUse('get_latest_prices', { commodity: 'castor' }, 'tu1')], stop_reason: 'tool_use' },
      { content: [text('Castor in Gondal: ₹6,300/q today.')], stop_reason: 'end_turn' },
    ]);
    const out = await ask({ client, db: t.db, config }, 'Castor in Gondal?');
    expect(out).toEqual({ ok: true, answer: 'Castor in Gondal: ₹6,300/q today.', sources: [] });
    const r = requests[0];
    expect(r.model).toBe('claude-opus-5-5');
    expect(r.max_tokens).toBe(16000);
    expect(r.output_config).toEqual({ effort: 'medium' });
    expect(r.tool_choice).toBeUndefined();
    expect(r.thinking).toBeUndefined();
    expect(r.temperature).toBeUndefined();
    expect(r.messages[0]).toEqual({ role: 'user', content: 'Castor in Gondal?' });
    expect(r.tools.map((x: any) => x.name)).toEqual(['get_latest_prices', 'search_messages']);
    expect(r.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(r.system[0].text).toMatch(/never instructions/i);
    expect(r.fallbacks).toBe('default');
    // The SDK sends `betas` as a header, not in the body.
    expect(r.betas).toBeUndefined();
    expect(headers[0]!.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(JSON.stringify(requests[1].messages)).toContain('"type":"tool_result"');
  });

  it('search_messages ids become sources', async () => {
    const { client } = scriptedAnthropic([
      { content: [toolUse('search_messages', { text: 'arenda' }, 'tu1')], stop_reason: 'tool_use' },
      { content: [text('A trader in Gondal quoted 1260 for arenda.')], stop_reason: 'end_turn' },
    ]);
    const out = await ask({ client, db: t.db, config }, 'What are traders saying about arenda?');
    expect(out).toEqual({ ok: true, answer: 'A trader in Gondal quoted 1260 for arenda.', sources: [messageId] });
  });

  it('invented number → unverified_numbers', async () => {
    const { client } = scriptedAnthropic([
      { content: [toolUse('get_latest_prices', { commodity: 'castor' }, 'tu1')], stop_reason: 'tool_use' },
      { content: [text('Castor is ₹9,999 today.')], stop_reason: 'end_turn' },
    ]);
    const out = await ask({ client, db: t.db, config }, 'Castor price?');
    expect(out).toEqual({ ok: false, reason: 'unverified_numbers', detail: expect.stringContaining('9999') });
  });

  it('an answer with no tool call at all has no evidence, so any number in it is unverified', async () => {
    const { client } = scriptedAnthropic([{ content: [text('Castor is ₹6,300 today.')], stop_reason: 'end_turn' }]);
    const out = await ask({ client, db: t.db, config }, 'Castor price?');
    expect(out).toMatchObject({ ok: false, reason: 'unverified_numbers' });
  });

  test.each(['refusal', 'max_tokens'])('%s → no partial answer', async (stop) => {
    const { client } = scriptedAnthropic([{ content: [text('Castor is ₹6,')], stop_reason: stop }]);
    const out = await ask({ client, db: t.db, config }, 'Castor price?');
    expect(out).toEqual({ ok: false, reason: stop, detail: expect.any(String) });
    expect(JSON.stringify(out)).not.toContain('Castor is');
  });

  it('builds the answer from text blocks only, ignoring thinking and fallback blocks', async () => {
    const { client } = scriptedAnthropic([
      {
        content: [
          { type: 'thinking', thinking: 'The price might be 7777.', signature: 'sig' },
          { type: 'fallback', model: 'claude-other' },
          text('No data for that market.'),
        ],
        stop_reason: 'end_turn',
      },
    ]);
    const out = await ask({ client, db: t.db, config }, 'Castor in Mars?');
    expect(out).toEqual({ ok: true, answer: 'No data for that market.', sources: [] });
  });

  it('a final message without text → no_answer', async () => {
    const { client } = scriptedAnthropic([{ content: [], stop_reason: 'end_turn' }]);
    const out = await ask({ client, db: t.db, config }, 'q');
    expect(out).toMatchObject({ ok: false, reason: 'no_answer' });
  });

  it('a loop that ends on a tool call (iteration limit) is no_answer, not the text before the call', async () => {
    // 10 requests is the limit (8 tool calls + 2); the model still asks for a tool at the last one.
    const turns = Array.from({ length: 10 }, (_, i) => ({
      content: [text('Let me look that up.'), toolUse('get_latest_prices', {}, `tu${i}`)],
      stop_reason: 'tool_use',
    }));
    const { client, requests } = scriptedAnthropic(turns);
    const out = await ask({ client, db: t.db, config }, 'q');
    expect(requests).toHaveLength(10);
    expect(out).toMatchObject({ ok: false, reason: 'no_answer' });
  });

  it('9th tool call is refused and its handler never runs', async () => {
    const spy = vi.spyOn(marketTools[0]!, 'run');
    const calls = Array.from({ length: 9 }, (_, i) => ({
      content: [toolUse('get_latest_prices', {}, `tu${i}`)],
      stop_reason: 'tool_use',
    }));
    const { client, requests } = scriptedAnthropic([...calls, { content: [text('No data.')], stop_reason: 'end_turn' }]);
    const out = await ask({ client, db: t.db, config }, 'q');
    expect(out).toEqual({ ok: true, answer: 'No data.', sources: [] });
    expect(requests).toHaveLength(10);
    expect(spy).toHaveBeenCalledTimes(8);
    const last = requests[9].messages.at(-1).content[0];
    expect(last).toMatchObject({ type: 'tool_result', tool_use_id: 'tu8', is_error: true });
    expect(last.content).toBe('Tool-call budget used up. Answer from the results you already have.');
    // The eighth call still ran and succeeded.
    expect(requests[8].messages.at(-1).content[0]).toMatchObject({ tool_use_id: 'tu7' });
    expect(requests[8].messages.at(-1).content[0].is_error).toBeFalsy();
  });

  it('the cap counts tool calls, not turns: parallel calls in one turn use the budget one by one', async () => {
    const spy = vi.spyOn(marketTools[0]!, 'run');
    const parallel = Array.from({ length: 10 }, (_, i) => toolUse('get_latest_prices', {}, `p${i}`));
    const { client, requests } = scriptedAnthropic([
      { content: parallel, stop_reason: 'tool_use' },
      { content: [text('No data.')], stop_reason: 'end_turn' },
    ]);
    await ask({ client, db: t.db, config }, 'q');
    expect(spy).toHaveBeenCalledTimes(8);
    const results = requests[1].messages.at(-1).content as Array<{ tool_use_id: string; is_error?: boolean }>;
    expect(results.filter((r) => r.is_error).map((r) => r.tool_use_id)).toEqual(['p8', 'p9']);
  });

  it('a tool call with invalid input is an error result, not a crash', async () => {
    const { client, requests } = scriptedAnthropic([
      { content: [toolUse('search_messages', { text: '' }, 'tu1')], stop_reason: 'tool_use' },
      { content: [text('No data.')], stop_reason: 'end_turn' },
    ]);
    const out = await ask({ client, db: t.db, config }, 'q');
    expect(out).toMatchObject({ ok: true, answer: 'No data.' });
    expect(requests[1].messages.at(-1).content[0]).toMatchObject({ tool_use_id: 'tu1', is_error: true });
  });
});
