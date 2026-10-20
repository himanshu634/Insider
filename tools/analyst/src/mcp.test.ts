import type { Db, MarketTool, ToolContext } from '@insider/api/agent';
import { expect, test, vi } from 'vitest';
import { z } from 'zod';

import { insiderToolDefs } from './mcp.js';
import type { ToolFailure } from './mcp.js';

// The fake tool ignores `db`, so no database is opened here.
const context = (max: number): ToolContext => ({
  db: {} as Db,
  budget: { used: 0, max },
  evidence: [],
  sources: new Set(),
});

const fakeTool = (run: MarketTool['run']): MarketTool => ({
  name: 'get_latest_prices',
  description: 'fake prices',
  input: z.object({}),
  run,
});

test('handler returns JSON text and records evidence', async () => {
  const ctx = context(1);
  const run = vi.fn(async (c: ToolContext) => {
    const rows = { modal: 6250 };
    c.evidence.push(JSON.stringify(rows, null, 1));
    return rows;
  });
  const [def] = insiderToolDefs(ctx, [fakeTool(run)]);

  const out = await def!.handler({}, undefined);

  expect(def!.name).toBe('get_latest_prices');
  expect(out.isError).toBeUndefined();
  expect(out.content).toEqual([{ type: 'text', text: '{"modal":6250}' }]);
  expect(ctx.evidence).toEqual(['{\n "modal": 6250\n}']);
  expect(ctx.budget.used).toBe(1);
});

test('second call over budget is an error and run is not called', async () => {
  const ctx = context(1);
  const run = vi.fn(async () => ({ modal: 6250 }));
  const failures: ToolFailure[] = [];
  const [def] = insiderToolDefs(ctx, [fakeTool(run)], failures);

  await def!.handler({}, undefined);
  const over = await def!.handler({}, undefined);

  expect(over).toEqual({
    content: [{ type: 'text', text: 'Tool-call budget used up. Answer from the results you already have.' }],
    isError: true,
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(ctx.budget.used).toBe(1);
  // A refused call is the cap working, not a broken tool.
  expect(failures).toEqual([]);
});

test('a tool that throws is recorded as a failure and returned as an error result', async () => {
  const ctx = context(5);
  const boom = new Error('connection refused');
  const failures: ToolFailure[] = [];
  const [def] = insiderToolDefs(ctx, [fakeTool(async () => Promise.reject(boom))], failures);

  const out = await def!.handler({}, undefined);

  expect(out).toEqual({
    content: [{ type: 'text', text: 'tool get_latest_prices failed: connection refused' }],
    isError: true,
  });
  expect(failures).toEqual([{ tool: 'get_latest_prices', error: boom }]);
  // The call still counts against the cap.
  expect(ctx.budget.used).toBe(1);
});
