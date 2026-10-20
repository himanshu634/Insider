/** Ask: one question, answered by the agent from the market tools. */
import { Hono } from 'hono';

import { ask } from '../agent/ask.js';
import type { Schemas } from '../contract.js';
import type { AppEnv } from '../env.js';
import { body } from '../http.js';

/**
 * What the client gets when the agent gave no answer we can stand behind (a refusal, a cut-off, a number no tool
 * returned, no text). Fixed text with no digits in it: model text is never passed on in these cases.
 */
export const ASK_FALLBACK =
  "I could not give a checked answer from Insider's data for this question. Try asking about one commodity and one mandi.";

export const askRoutes = new Hono<AppEnv>();

askRoutes.post('/v1/ask', body('AskRequest'), async (c) => {
  const { question } = c.req.valid('json');
  // An empty question is the caller's mistake whatever the server is set up for, and the API rejects empty text.
  if (!question.trim()) return c.json({ detail: 'question must not be empty' }, 422);

  const client = c.var.anthropic;
  if (!client) return c.json({ detail: 'Ask is not configured (set ANTHROPIC_API_KEY)' }, 501);

  // A tool that fails throws out of `ask`; app.onError turns it into a 500. That is our fault, not a "no answer".
  const outcome = await ask({ client, db: c.var.db, config: c.var.config }, question);
  if (!outcome.ok) {
    console.warn('ask failed', outcome.reason, outcome.detail);
    return c.json({ answer: ASK_FALLBACK, sources: [] } satisfies Schemas['AskResponse']);
  }
  return c.json({ answer: outcome.answer, sources: outcome.sources } satisfies Schemas['AskResponse']);
});
