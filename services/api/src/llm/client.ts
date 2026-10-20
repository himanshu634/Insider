import Anthropic from '@anthropic-ai/sdk';

import type { Config } from '../config.js';

/**
 * The Anthropic client, or null when ANTHROPIC_API_KEY is unset (callers answer 501).
 * Pass `opts.fetch` to stub the network in tests; retries are off then, so a stub sees each call once.
 */
export function createAnthropic(config: Config, opts?: { fetch?: typeof fetch }): Anthropic | null {
  if (!config.anthropicApiKey) return null;
  return new Anthropic({
    apiKey: config.anthropicApiKey,
    fetch: opts?.fetch,
    maxRetries: opts?.fetch ? 0 : 2,
  });
}
