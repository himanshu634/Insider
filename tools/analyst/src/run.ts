/**
 * Runs one analyst question through the Agent SDK and turns the message stream into output and an exit code:
 * 0 answered; 1 failed (an error result, an API error, a refusal or cut-off, a broken tool, a crash);
 * 2 refused to run on a non-API-key login.
 */
import type { Options, query } from '@anthropic-ai/claude-agent-sdk';
import { uncheckedNumbers } from '@insider/api/agent';

import type { ToolFailure } from './mcp.js';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runAnalyst(
  question: string,
  deps: {
    query: typeof query;
    options: Options;
    /** The tool context's evidence. Read when the result arrives, after the tools have run. */
    evidence: readonly string[];
    /** Filled by the tool handlers during the run. */
    failures: readonly ToolFailure[];
    write: (s: string) => void;
  },
): Promise<number> {
  const { write } = deps;
  let code: number | undefined;
  try {
    for await (const message of deps.query({ prompt: question, options: deps.options })) {
      if (message.type === 'system' && message.subtype === 'init') {
        // Policy: API key only. A claude.ai login would bill and log the work to a person's account.
        if (message.apiKeySource !== 'ANTHROPIC_API_KEY') {
          write('refusing to run on a non-API-key login\n');
          code = 2;
          break;
        }
      } else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') write(`${block.text}\n`);
        }
      } else if (message.type === 'result') {
        if (message.subtype !== 'success') {
          write(`${message.errors.join('\n')}\n`);
          code = 1;
        } else if (message.is_error) {
          // A turn that ended on an API error (a 401, an overload, no credit): `result` is the error text.
          write(`${message.result}\n`);
          code = 1;
        } else if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
          // A refused or cut-off turn is not an answer, whatever text streamed before it: the run fails.
          write(`stopped: ${message.stop_reason}\n`);
          code = 1;
        } else {
          write(`\n— ${message.num_turns} turns, ~$${message.total_cost_usd.toFixed(2)}\n`);
          const unchecked = uncheckedNumbers(message.result, deps.evidence);
          if (unchecked.length > 0) write(`⚠ unverified numbers: ${unchecked.join(', ')}\n`);
          // A broken tool is our fault: the answer may be the model's "no data" for it, so the run fails.
          for (const f of deps.failures) write(`⚠ tool ${f.tool} failed: ${messageOf(f.error)}\n`);
          code = deps.failures.length > 0 ? 1 : 0;
        }
      }
    }
  } catch (error) {
    // query() throws after it yields an error result; that result already set the code and was written.
    if (code !== undefined) return code;
    write(`${messageOf(error)}\n`);
    return 1;
  }
  if (code === undefined) {
    write('the analyst stopped with no result\n');
    return 1;
  }
  return code;
}
