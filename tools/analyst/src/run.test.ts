import type { Options, query } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test, vi } from 'vitest';

import type { ToolFailure } from './mcp.js';
import { runAnalyst } from './run.js';

// SDKMessage-shaped objects: only the fields runAnalyst reads.
const init = (apiKeySource = 'ANTHROPIC_API_KEY') => ({ type: 'system', subtype: 'init', apiKeySource, tools: [] });
const assistant = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const success = (result: string) => ({
  type: 'result',
  subtype: 'success',
  result,
  num_turns: 3,
  total_cost_usd: 0.0412,
});

/** A scripted `query`: yields the messages, then throws `after` if given (as the SDK does after an error result). */
function scripted(messages: object[], after?: Error) {
  const state = { calls: [] as unknown[], closed: false };
  const fake = (params: unknown) => {
    state.calls.push(params);
    return (async function* () {
      try {
        for (const m of messages) yield m;
        if (after) throw after;
      } finally {
        state.closed = true;
      }
    })();
  };
  return { query: fake as unknown as typeof query, state };
}

const options = { model: 'claude-opus-5-5' } as Options;

function run(messages: object[], extra: { evidence?: string[]; failures?: ToolFailure[]; after?: Error } = {}) {
  const fake = scripted(messages, extra.after);
  let out = '';
  const code = runAnalyst('Where is castor cheapest?', {
    query: fake.query,
    options,
    evidence: extra.evidence ?? [],
    failures: extra.failures ?? [],
    write: (s) => {
      out += s;
    },
  });
  return { code, out: () => out, state: fake.state };
}

describe('runAnalyst', () => {
  test('success → prints answer and cost, exit 0', async () => {
    const r = run([init(), assistant('Castor ₹6,250'), success('Castor ₹6,250')], { evidence: ['6250'] });

    expect(await r.code).toBe(0);
    expect(r.out()).toContain('Castor ₹6,250');
    expect(r.out()).toContain('\n— 3 turns, ~$0.04');
    expect(r.out()).not.toContain('⚠');
    expect(r.state.calls).toEqual([{ prompt: 'Where is castor cheapest?', options }]);
  });

  test('budget error → exit 1', async () => {
    const r = run([init(), { type: 'result', subtype: 'error_max_budget_usd', errors: ['budget'] }], {
      after: new Error('Claude Code process exited with code 1'),
    });

    expect(await r.code).toBe(1);
    expect(r.out()).toContain('budget');
    // The throw that follows an error result is expected; only the result's errors are shown.
    expect(r.out()).not.toContain('exited with code');
  });

  test('every error subtype exits 1 with its errors', async () => {
    for (const subtype of ['error_max_turns', 'error_during_execution', 'error_max_structured_output_retries']) {
      const r = run([init(), { type: 'result', subtype, errors: ['first', 'second'] }]);
      expect(await r.code).toBe(1);
      expect(r.out()).toContain('first\nsecond');
    }
  });

  test('non-API-key login → exit 2 before any answer', async () => {
    const r = run([init('oauth'), assistant('Castor ₹6,250'), success('Castor ₹6,250')]);

    expect(await r.code).toBe(2);
    expect(r.out()).toContain('refusing to run on a non-API-key login');
    expect(r.out()).not.toContain('Castor');
    expect(r.state.closed).toBe(true);
  });

  test("current CLIs report a claude.ai login as 'none' → exit 2", async () => {
    const r = run([init('none'), assistant('Castor ₹6,250'), success('Castor ₹6,250')]);

    expect(await r.code).toBe(2);
    expect(r.out()).not.toContain('Castor');
  });

  test('unverified number is flagged', async () => {
    const r = run([init(), assistant('₹9,999'), success('₹9,999')], { evidence: ['6250'] });

    expect(await r.code).toBe(0);
    expect(r.out()).toContain('⚠ unverified numbers: 9999');
  });

  test('a failed tool → warning and exit 1, even on a success result', async () => {
    const failures: ToolFailure[] = [{ tool: 'get_latest_prices', error: new Error('connection refused') }];
    const r = run([init(), assistant('No data for castor.'), success('No data for castor.')], { failures });

    expect(await r.code).toBe(1);
    expect(r.out()).toContain('⚠ tool get_latest_prices failed: connection refused');
  });

  test('query throws before any result → message and exit 1', async () => {
    const r = run([init()], { after: new Error('spawn claude ENOENT') });

    expect(await r.code).toBe(1);
    expect(r.out()).toContain('spawn claude ENOENT');
  });

  test('stream ends with no result → exit 1', async () => {
    const r = run([init(), assistant('half an answer')]);

    expect(await r.code).toBe(1);
    expect(r.out()).toContain('no result');
  });
});
