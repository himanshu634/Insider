/**
 * The shared market tools as an in-process MCP server for the Agent SDK. The model sees them as
 * `mcp__insider__<tool>`. Each handler enforces the same tool-call cap as the Ask adapter
 * (services/api/src/agent/ask.ts `toRunnerTool`): check, count, then run.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { marketTools } from '@insider/api/agent';
import type { MarketTool, ToolContext } from '@insider/api/agent';
import type { z } from 'zod';

export const BUDGET_USED_UP = 'Tool-call budget used up. Answer from the results you already have.';

/** A tool that broke with an error of ours (a database error, a bug), not the cap refusing a call. */
export interface ToolFailure {
  tool: string;
  error: unknown;
}

/**
 * One SDK tool per market tool. A thrown error is added to `failures` and shown to the model as an error
 * result; the run then exits 1, so a broken tool never reads as "no data".
 */
export function insiderToolDefs(
  ctx: ToolContext,
  tools: readonly MarketTool[] = marketTools,
  failures: ToolFailure[] = [],
): SdkMcpToolDefinition<z.ZodRawShape>[] {
  return tools.map((t) =>
    // The MCP server validates the model's input against this shape before the handler runs.
    tool(t.name, t.description, t.input.shape, async (args) => {
      // Check and count before the first await: calls of one model turn can run together and share the budget.
      if (ctx.budget.used >= ctx.budget.max) {
        return { content: [{ type: 'text', text: BUDGET_USED_UP }], isError: true };
      }
      ctx.budget.used += 1;
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await t.run(ctx, args)) }] };
      } catch (error) {
        failures.push({ tool: t.name, error });
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `tool ${t.name} failed: ${message}` }], isError: true };
      }
    }),
  );
}

export function insiderMcpServer(ctx: ToolContext, failures?: ToolFailure[]): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'insider',
    version: '0.1.0',
    tools: insiderToolDefs(ctx, marketTools, failures),
    // Without this, tool search may defer the tools and the model would not see them up front.
    alwaysLoad: true,
  });
}
