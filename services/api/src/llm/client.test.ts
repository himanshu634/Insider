import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, test, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { createAnthropic } from './client.js';

describe('createAnthropic', () => {
  test('no key → null', () => {
    expect(createAnthropic(loadConfig({ ANTHROPIC_API_KEY: '' }))).toBeNull();
  });

  test('key → client', () => {
    expect(createAnthropic(loadConfig({ ANTHROPIC_API_KEY: 'sk-test' }))).toBeInstanceOf(Anthropic);
  });

  test('a stub fetch is used and a failing call is not retried', async () => {
    const stub = vi.fn<typeof fetch>(async () => new Response('{}', { status: 500 }));
    const client = createAnthropic(loadConfig({ ANTHROPIC_API_KEY: 'sk-test' }), { fetch: stub });
    await expect(
      client!.messages.create({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow();
    expect(stub).toHaveBeenCalledTimes(1);
  });
});

describe('Ask config', () => {
  test('ask defaults', () => {
    const c = loadConfig({});
    expect([c.agentModel, c.askEffort, c.askMaxToolCalls]).toEqual(['claude-opus-5-5', 'medium', 8]);
  });

  test('INSIDER_AGENT_MODEL overrides the model; empty falls back to the default', () => {
    expect(loadConfig({ INSIDER_AGENT_MODEL: 'claude-haiku-5' }).agentModel).toBe('claude-haiku-5');
    expect(loadConfig({ INSIDER_AGENT_MODEL: '' }).agentModel).toBe('claude-opus-5-5');
  });

  test('empty ANTHROPIC_API_KEY counts as unset', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: '' }).anthropicApiKey).toBeUndefined();
    expect(loadConfig({ ANTHROPIC_API_KEY: 'sk-test' }).anthropicApiKey).toBe('sk-test');
  });
});
