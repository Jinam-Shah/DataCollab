// Runs the agent (or the single-shot baseline) with tracing. Shared by the HTTP API and eval.
import { runAgent, runSingleShot, type AgentResult, type AgentStep } from './graph';
import { createChatModel, type ModelInfo } from './llm';
import { startRun } from './trace';
import type { PromptVariant } from './prompts';
import type { Workspace } from '../services/workspaceService';
import type { SchemaOptions } from './schema';
import { tracer, recordAgentRun, recordStepSpan, recordToolCall } from '../observability/metrics';

export interface AskOptions {
  workspace: Workspace;
  question: string;
  mode?: 'agent' | 'single_shot';
  userId?: number | null;
  promptVariant?: PromptVariant;
  schemaOptions?: SchemaOptions;
  maxRetries?: number;
  summarize?: boolean;
  source?: 'app' | 'eval' | 'mcp';
  evalRun?: string | null;
  modelInfo?: ModelInfo;
  onStep?: (runId: number, step: AgentStep) => void;
}

export function defaultPromptVariant(): PromptVariant {
  // A beat B on the eval set (82.5% vs 77.5%, not significant; see METRICS.md), so A is the default.
  return process.env.AGENT_PROMPT_VARIANT === 'B' ? 'B' : 'A';
}

export async function ask(
  opts: AskOptions
): Promise<AgentResult & { runId: number; latencyMs: number }> {
  const modelInfo = opts.modelInfo ?? createChatModel();
  const mode = opts.mode ?? 'agent';
  const promptVariant = mode === 'agent' ? (opts.promptVariant ?? defaultPromptVariant()) : null;
  const schemaOptions = opts.schemaOptions ?? {
    includeProfiles: process.env.AGENT_COLUMN_PROFILES !== 'false',
  };
  // One span per run; each recorded step becomes a child span (agent.step.<type>).
  return tracer.startActiveSpan('agent.run', async (span) => {
    span.setAttributes({
      'agent.mode': mode,
      'agent.model': modelInfo.name,
      'agent.prompt_variant': promptVariant ?? '',
    });
    const trace = await startRun(
      {
        userId: opts.userId,
        workspaceSlug: opts.workspace.slug,
        question: opts.question,
        mode,
        model: modelInfo.name,
        promptVariant,
        source: opts.source,
        evalRun: opts.evalRun,
      },
      opts.onStep
    );
    span.setAttribute('agent.run_id', trace.runId);

    const onStep = async (step: AgentStep) => {
      recordStepSpan(
        `agent.step.${step.type}`,
        step.latencyMs,
        {
          'agent.run_id': trace.runId,
          'agent.tool': step.toolName,
          'gen_ai.usage.input_tokens': step.inputTokens,
          'gen_ai.usage.output_tokens': step.outputTokens,
        },
        step.error
      );
      if (step.toolName && ['run_sql', 'get_schema', 'search_documents'].includes(step.type)) {
        recordToolCall(step.toolName, !step.error);
      }
      await trace.onStep(step);
    };

    const started = Date.now();
    const common = { workspace: opts.workspace, model: modelInfo.model, schemaOptions, onStep };
    const result =
      mode === 'agent'
        ? await runAgent(opts.question, {
            ...common,
            promptVariant: promptVariant as PromptVariant,
            maxRetries: opts.maxRetries,
            summarize: opts.summarize,
          })
        : await runSingleShot(opts.question, common);
    const latencyMs = Date.now() - started;
    await trace.finish(result, latencyMs);
    recordAgentRun(latencyMs, { mode, status: result.status });
    span.setAttributes({ 'agent.status': result.status, 'agent.attempts': result.attempts.length });
    span.end();
    return { ...result, runId: trace.runId, latencyMs };
  });
}
