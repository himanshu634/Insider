import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { marketTools } from '../src/agent/index.js';
import { validatorFor } from '../src/contract.js';
import { commodity, dailyPrice, market } from '../src/db/schema.js';
import { ASK_FALLBACK } from '../src/routes/ask.js';
import { setup } from './helpers.js';
import { scriptedAnthropic, text, toolUse } from './scripted-anthropic.js';

const ask = (t: Awaited<ReturnType<typeof setup>>, json: unknown) =>
  t.request('/v1/ask', { method: 'POST', json, device: false });

describe('POST /v1/ask', () => {
  let t: Awaited<ReturnType<typeof setup>> | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await t?.close();
    t = undefined;
  });

  it('501 without a key', async () => {
    t = await setup();
    const res = await ask(t, { question: 'castor?' });
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ detail: 'Ask is not configured (set ANTHROPIC_API_KEY)' });
  });

  it('422 on a missing question', async () => {
    t = await setup();
    expect((await ask(t, {})).status).toBe(422);
  });

  it('422 on a missing question even when a client is set', async () => {
    t = await setup({ anthropic: scriptedAnthropic([]).client });
    expect((await ask(t, {})).status).toBe(422);
  });

  describe('with a client', () => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    /** Castor in Gondal at 6300, so that an answer quoting "₹6,300" passes the number check. */
    async function seedCastorPrice(db: NonNullable<typeof t>['db']) {
      const [castor] = await db.select().from(commodity).where(eq(commodity.slug, 'castor'));
      const [gondal] = await db.select().from(market).where(eq(market.slug, 'gondal'));
      await db.insert(dailyPrice).values({
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
    }

    it('200 with an answer', async () => {
      const { client } = scriptedAnthropic([
        { content: [toolUse('get_latest_prices', { commodity: 'castor' }, 'tu1')], stop_reason: 'tool_use' },
        { content: [text('Castor in Gondal: ₹6,300/q today.')], stop_reason: 'end_turn' },
      ]);
      t = await setup({ anthropic: client });
      await seedCastorPrice(t.db);

      const res = await ask(t, { question: 'Castor in Gondal?' });
      expect(res.status).toBe(200);
      const body = await res.json();
      const validate = validatorFor('AskResponse');
      expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
      expect(body.answer).toBe('Castor in Gondal: ₹6,300/q today.');
      expect(Array.isArray(body.sources)).toBe(true);
      expect(body.sources.every(Number.isInteger)).toBe(true);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('refusal → fallback, no digits', async () => {
      const { client } = scriptedAnthropic([{ content: [text('Castor is ₹6,')], stop_reason: 'refusal' }]);
      t = await setup({ anthropic: client });

      const res = await ask(t, { question: 'Castor price?' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(validatorFor('AskResponse')(body)).toBe(true);
      expect(body).toEqual({ answer: ASK_FALLBACK, sources: [] });
      expect(body.answer).toBe(
        "I could not give a checked answer from Insider's data for this question. Try asking about one commodity and one mandi.",
      );
      expect(/\d/.test(body.answer)).toBe(false);
      expect(console.warn).toHaveBeenCalledWith('ask failed', 'refusal', expect.any(String));
    });

    it('an unchecked number → fallback, the model text never reaches the client', async () => {
      const { client } = scriptedAnthropic([{ content: [text('Castor is ₹9,999 today.')], stop_reason: 'end_turn' }]);
      t = await setup({ anthropic: client });

      const res = await ask(t, { question: 'Castor price?' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ answer: ASK_FALLBACK, sources: [] });
      expect(JSON.stringify(body)).not.toContain('9,999');
      expect(console.warn).toHaveBeenCalledWith('ask failed', 'unverified_numbers', expect.stringContaining('9999'));
    });

    it('a tool that breaks → 500 through onError', async () => {
      vi.spyOn(marketTools[0]!, 'run').mockRejectedValueOnce(new Error('db down'));
      const { client } = scriptedAnthropic([
        { content: [toolUse('get_latest_prices', {}, 'tu1')], stop_reason: 'tool_use' },
        { content: [text('No data.')], stop_reason: 'end_turn' },
      ]);
      t = await setup({ anthropic: client });

      const res = await ask(t, { question: 'Castor price?' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ detail: 'Internal error' });
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});
