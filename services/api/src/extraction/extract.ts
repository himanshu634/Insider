/**
 * The one extraction call per message. Every call is logged in `llm_call` with its full request (CX-05).
 * A refusal, a cut-off answer or output that does not fit the schema stores no rows (SF-04, SF-06): a
 * cut-off answer is retried once with a higher limit first. Network and API errors throw, so the job retries.
 */
import { createHash } from 'node:crypto';

import type Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq } from 'drizzle-orm';

import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { llmCall } from '../db/schema.js';
import { ExtractionOutput, OUTPUT_FORMAT, PROMPT_VERSION } from './prompt.js';

/** Output-token limits: the first try, then one retry for a long rate list. */
export const MAX_TOKENS = [4096, 16000] as const;

export type ExtractResult =
  | { outcome: 'ok'; output: ExtractionOutput; llmCallId: number; modelVersion: string }
  | { outcome: 'refusal' | 'max_tokens' | 'invalid_output'; llmCallId: number };

interface Deps {
  db: Db;
  client: Anthropic;
  config: Config;
}

function read(
  stopReason: string | null,
  content: readonly Anthropic.ContentBlock[],
): { outcome: ExtractResult['outcome']; output?: ExtractionOutput } {
  if (stopReason === 'refusal') return { outcome: 'refusal' };
  if (stopReason === 'max_tokens') return { outcome: 'max_tokens' };
  const text = content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  try {
    const parsed = ExtractionOutput.safeParse(JSON.parse(text));
    return parsed.success ? { outcome: 'ok', output: parsed.data } : { outcome: 'invalid_output' };
  } catch {
    return { outcome: 'invalid_output' };
  }
}

/**
 * The output of this message's latest successful call with the current prompt. A job retried after its save
 * failed uses it instead of paying for the same call again.
 */
export async function previousExtraction(
  db: Db,
  messageId: number,
): Promise<Extract<ExtractResult, { outcome: 'ok' }> | undefined> {
  const [call] = await db
    .select()
    .from(llmCall)
    .where(
      and(
        eq(llmCall.messageId, messageId),
        eq(llmCall.purpose, 'extract'),
        eq(llmCall.outcome, 'ok'),
        eq(llmCall.promptVersion, PROMPT_VERSION),
      ),
    )
    .orderBy(desc(llmCall.id))
    .limit(1);
  if (!call) return undefined;
  const { output } = read(call.stopReason, (call.response?.content ?? []) as Anthropic.ContentBlock[]);
  return output && { outcome: 'ok', output, llmCallId: call.id, modelVersion: `${call.model}:${PROMPT_VERSION}` };
}

export async function callExtractor(
  { db, client, config }: Deps,
  messageId: number,
  system: string,
  packet: string,
): Promise<ExtractResult> {
  let result: ExtractResult | undefined;
  for (const maxTokens of MAX_TOKENS) {
    const request = {
      model: config.extractionModel,
      max_tokens: maxTokens,
      system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user' as const, content: packet }],
      output_config: { format: OUTPUT_FORMAT },
    } satisfies Anthropic.MessageCreateParamsNonStreaming;
    const response = await client.messages.create(request);
    const { outcome, output } = read(response.stop_reason, response.content);

    const [logged] = await db
      .insert(llmCall)
      .values({
        messageId,
        purpose: 'extract',
        model: config.extractionModel,
        promptVersion: PROMPT_VERSION,
        packetHash: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
        request,
        response: { content: response.content, model: response.model },
        stopReason: response.stop_reason,
        outcome,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      })
      .returning({ id: llmCall.id });

    result = output
      ? { outcome: 'ok', output, llmCallId: logged!.id, modelVersion: `${config.extractionModel}:${PROMPT_VERSION}` }
      : { outcome: outcome as Exclude<ExtractResult['outcome'], 'ok'>, llmCallId: logged!.id };
    if (outcome !== 'max_tokens') break;
  }
  return result!;
}
