// Runs the agent (or the single-shot baseline) with tracing. Shared by the HTTP API and eval.
import { runAgent, runSingleShot, type AgentResult, type AgentStep } from './graph';
import { createChatModel, type ModelInfo } from './llm';
import { startRun } from './trace';
import type { PromptVariant } from './prompts';
import type { Workspace } from '../services/workspaceService';
import type { SchemaOptions } from './schema';

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
  return process.env.AGENT_PROMPT_VARIANT === 'A' ? 'A' : 'B';
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

  const started = Date.now();
  const common = {
    workspace: opts.workspace,
    model: modelInfo.model,
    schemaOptions,
    onStep: trace.onStep,
  };
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
  return { ...result, runId: trace.runId, latencyMs };
}
