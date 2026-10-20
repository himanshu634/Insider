import Anthropic from '@anthropic-ai/sdk';

export interface ScriptedTurn {
  content: unknown[];
  stop_reason: string;
}

/** A `tool_use` block, as the model would send it. */
export const toolUse = (name: string, input: unknown, id: string) => ({ type: 'tool_use', id, name, input });

/** A `text` block. */
export const text = (s: string) => ({ type: 'text', text: s });

/**
 * A real Anthropic client whose `fetch` replays `turns`, one Message per request, so tests never touch the network.
 * `requests` holds each request body and `headers` each request's headers, in call order.
 * A request after the last turn throws.
 */
export function scriptedAnthropic(turns: readonly ScriptedTurn[]) {
  const requests: any[] = [];
  const headers: Headers[] = [];
  let next = 0;
  const fetch = async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    headers.push(new Headers(init?.headers));
    const turn = turns[next++];
    if (!turn) throw new Error(`scriptedAnthropic: request ${next} has no scripted turn (only ${turns.length})`);
    const message = {
      id: `msg_${next}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: turn.content,
      stop_reason: turn.stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new Anthropic({ apiKey: 'test', maxRetries: 0, fetch: fetch as typeof globalThis.fetch });
  return { client, requests, headers };
}
