/**
 * Live smoke test against the real Claude Code binary and the Anthropic API. Skipped unless INSIDER_LIVE_LLM=1;
 * it costs a few cents. Run: INSIDER_LIVE_LLM=1 pnpm --filter @insider/analyst exec vitest --run src/live.test.ts
 * This is the only test that checks `tools: []` and `strictMcpConfig` against the real binary.
 */
import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk';
import { createToolContext, loadConfig } from '@insider/api/agent';
import type { Db, MarketTool } from '@insider/api/agent';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { insiderToolDefs } from './mcp.js';
import type { ToolFailure } from './mcp.js';
import { analystOptions } from './options.js';
import { runAnalyst } from './run.js';

test.skipIf(process.env.INSIDER_LIVE_LLM !== '1')(
  'live: the analyst answers from an insider tool and has no built-in tools',
  async () => {
    // The fake tool ignores `db`, so no database is opened.
    const ctx = createToolContext({} as Db, 5);
    const fakeTool: MarketTool = {
      name: 'get_latest_prices',
      description: 'The newest modal price of castor at Rajkot, in rupees per quintal.',
      input: z.object({}),
      async run(c) {
        const row = { modal_per_quintal: 6250 };
        c.evidence.push(JSON.stringify(row, null, 1));
        return row;
      },
    };
    const failures: ToolFailure[] = [];
    const server = createSdkMcpServer({
      name: 'insider',
      version: '0.1.0',
      tools: insiderToolDefs(ctx, [fakeTool], failures),
      alwaysLoad: true,
    });
    const options = analystOptions(server, { model: loadConfig().agentModel, maxBudgetUsd: 0.5, env: process.env });

    // Pass the real stream through, keeping the init message's tool list.
    let initTools: string[] | undefined;
    const watched = ((params: Parameters<typeof query>[0]) =>
      (async function* () {
        for await (const message of query(params)) {
          if (message.type === 'system' && message.subtype === 'init') initTools = message.tools;
          yield message;
        }
      })()) as unknown as typeof query;

    let out = '';
    const code = await runAnalyst('Call get_latest_prices and tell me the modal price.', {
      query: watched,
      options,
      evidence: ctx.evidence,
      failures,
      write: (s) => {
        out += s;
      },
    });

    expect(code, out).toBe(0);
    // The model may write the price with a grouping comma (₹6,250).
    expect(out.replaceAll(',', '')).toContain('6250');
    expect(initTools).toBeDefined();
    expect(initTools).toContain('mcp__insider__get_latest_prices');
    // No built-in tools and no other MCP server: every tool the session has is an insider tool.
    expect(initTools!.filter((t) => !t.startsWith('mcp__insider__'))).toEqual([]);
  },
  120_000,
);
