import { expect, it, vi } from 'vitest';

// contract.ts reads openapi.yaml when it loads. The analyst CLI imports the agent entry point and must not pay for that.
vi.mock('../src/contract.js', () => {
  throw new Error('src/agent/index.ts must not load contract.js at runtime');
});

it('the agent entry point loads without contract.js', async () => {
  const agent = await import('../src/agent/index.js');
  expect(Object.keys(agent).sort()).toEqual(['createDb', 'createToolContext', 'loadConfig', 'marketTools', 'uncheckedNumbers']);
});
