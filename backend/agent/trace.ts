// Records every agent run and every step (prompt, tool call, output, error, latency, tokens)
// in agent_runs / agent_steps. Used by the app, the eval harness and the MCP server.
import type { AgentResult, AgentStep } from './graph';
const pool = require('../config/database');

export interface RunMeta {
  userId?: number | null;
  workspaceSlug: string;
  question: string;
  mode: 'agent' | 'single_shot';
  model: string;
  promptVariant?: string | null;
  source?: 'app' | 'eval' | 'mcp';
  evalRun?: string | null;
}

// Large tool outputs (schemas, rows) are cut so one run cannot bloat the table.
function clip(value: unknown, max = 20000): unknown {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= max) return typeof value === 'string' ? JSON.stringify(value) : text;
  return JSON.stringify({ truncated: true, preview: text.slice(0, max) });
}

export interface RunTrace {
  runId: number;
  onStep: (step: AgentStep) => Promise<void>;
  finish: (result: AgentResult, latencyMs: number) => Promise<void>;
}

export async function startRun(
  meta: RunMeta,
  listener?: (runId: number, step: AgentStep) => void
): Promise<RunTrace> {
  const { rows } = await pool.query(
    `INSERT INTO agent_runs (user_id, workspace_id, question, mode, model, prompt_variant, source, eval_run)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      meta.userId ?? null,
      meta.workspaceSlug,
      meta.question,
      meta.mode,
      meta.model,
      meta.promptVariant ?? null,
      meta.source ?? 'app',
      meta.evalRun ?? null,
    ]
  );
  const runId: number = Number(rows[0].id);
  let index = 0;

  return {
    runId,
    onStep: async (step) => {
      const i = index++;
      if (listener) listener(runId, step);
      await pool.query(
        `INSERT INTO agent_steps (run_id, step_index, step_type, prompt, tool_name, tool_input, tool_output,
                                  error, latency_ms, input_tokens, output_tokens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          runId,
          i,
          step.type,
          step.prompt ?? null,
          step.toolName ?? null,
          clip(step.toolInput),
          clip(step.toolOutput ?? (step.message ? { message: step.message } : null)),
          step.error ?? null,
          Math.round(step.latencyMs),
          step.inputTokens ?? null,
          step.outputTokens ?? null,
        ]
      );
    },
    finish: async (result, latencyMs) => {
      await pool.query(
        `UPDATE agent_runs
            SET status = $2, final_sql = $3, answer = $4, attempts = $5, error = $6, latency_ms = $7,
                input_tokens = $8, output_tokens = $9, finished_at = now()
          WHERE id = $1`,
        [
          runId,
          result.status,
          result.sql,
          result.answer,
          result.attempts.length,
          result.error ?? result.attempts[result.attempts.length - 1]?.error ?? null,
          Math.round(latencyMs),
          result.usage.inputTokens,
          result.usage.outputTokens,
        ]
      );
    },
  };
}
