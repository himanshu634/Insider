/**
 * The internal analyst: `make analyst Q="Where is castor cheapest today?"`.
 * Exit codes: 0 answered, 1 failed or not set up, 2 refused a non-API-key login, 64 no question.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createDb, createToolContext, loadConfig } from '@insider/api/agent';

import { insiderMcpServer } from './mcp.js';
import type { ToolFailure } from './mcp.js';
import { analystOptions } from './options.js';
import { runAnalyst } from './run.js';

const USAGE = 'usage: make analyst Q="Where is castor cheapest today?"\n';

/** Tool calls one analyst question may make. */
const MAX_TOOL_CALLS = 20;

async function main(args: string[]): Promise<number> {
  const question = args.join(' ').trim();
  if (!question) {
    process.stderr.write(USAGE);
    return 64;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('Set ANTHROPIC_API_KEY in .env\n');
    return 1;
  }
  const maxBudgetUsd = Number(process.env.INSIDER_ANALYST_BUDGET_USD ?? 1);
  // NaN or a non-positive number would leave the session with no usable spend cap.
  if (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0) {
    process.stderr.write('INSIDER_ANALYST_BUDGET_USD must be a positive number of US dollars\n');
    return 1;
  }

  const config = loadConfig();
  const { db, close } = createDb(config.databaseUrl);
  try {
    const ctx = createToolContext(db, MAX_TOOL_CALLS);
    const failures: ToolFailure[] = [];
    const options = analystOptions(insiderMcpServer(ctx, failures), {
      model: config.agentModel,
      maxBudgetUsd,
      // Filtered to an allowlist inside analystOptions: DATABASE_URL never reaches the subprocess.
      env: process.env,
    });
    return await runAnalyst(question, {
      query,
      options,
      evidence: ctx.evidence,
      failures,
      write: (s) => process.stdout.write(s),
    });
  } finally {
    await close();
  }
}

process.exit(await main(process.argv.slice(2)));
