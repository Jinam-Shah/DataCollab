// The DataCollab agent, built with LangGraph.js.
//
//   plan -> get_schema -> write_sql -> run_sql -> check_result -> answer
//                            ^                        |
//                            +---- error / empty -----+--> give_up (after maxRetries)
//
// plan:        the model picks the tables it needs by calling get_schema (function calling)
// get_schema:  runs the get_schema tool
// write_sql:   the model submits SQL by calling run_readonly_query; earlier attempts and their
//              database errors are included in the prompt
// run_sql:     runs the query through the Phase 1 safety layer
// check_result: success -> answer; error or empty result -> retry while retries < maxRetries
// answer:      summarize_result turns rows into a short answer
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Workspace } from '../services/workspaceService';
import { makeTools, type RunQueryOutput } from './tools';
import { listTables, getWorkspaceSchema, schemaToText, type SchemaOptions } from './schema';
import {
  planMessages,
  writeSqlMessages,
  singleShotMessages,
  type Attempt,
  type PromptVariant,
} from './prompts';

export const DEFAULT_MAX_RETRIES = 3;

export type StepType =
  | 'plan'
  | 'get_schema'
  | 'search_documents'
  | 'write_sql'
  | 'run_sql'
  | 'check_result'
  | 'answer'
  | 'give_up';

export interface AgentStep {
  type: StepType;
  message: string;
  prompt?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  error?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AgentOptions {
  workspace: Workspace;
  model: BaseChatModel;
  promptVariant?: PromptVariant;
  maxRetries?: number;
  schemaOptions?: SchemaOptions;
  onStep?: (step: AgentStep) => void | Promise<void>;
}

export interface AgentResult {
  status: 'answered' | 'gave_up' | 'error';
  answer: string;
  sql: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  hasMore: boolean;
  attempts: Attempt[];
  retries: number;
  usage: { inputTokens: number; outputTokens: number };
  error?: string;
}

// ---------- helpers for reading model output ----------

function usageOf(msg: BaseMessage): { inputTokens?: number; outputTokens?: number } {
  const u = (msg as AIMessage).usage_metadata;
  return u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens } : {};
}

function promptText(messages: BaseMessage[]): string {
  return messages.map((m) => `[${m.getType()}] ${String(m.content)}`).join('\n\n');
}

function contentText(msg: BaseMessage): string {
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? '')))
      .join('');
  }
  return '';
}

/**
 * Read the arguments of a tool call. Uses native tool calls when the model makes them, and
 * falls back to a JSON object in the text ({"name": ..., "arguments": {...}}), which some
 * open models emit instead.
 */
export function extractToolArgs(msg: BaseMessage, name: string): Record<string, unknown> | null {
  const calls = (msg as AIMessage).tool_calls ?? [];
  const call = calls.find((c) => c.name === name) ?? calls[0];
  if (call) return call.args as Record<string, unknown>;

  const text = contentText(msg).replace(/```(?:json)?/gi, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object') {
        return (parsed.arguments ?? parsed.parameters ?? parsed.args ?? parsed) as Record<
          string,
          unknown
        >;
      }
    } catch {
      // not JSON
    }
  }
  return null;
}

/** Find SQL in free text (code fences, or from the first SELECT/WITH). */
export function extractSqlFromText(text: string): string | null {
  const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  let sql = fenced ? fenced[1] : text;
  const start = sql.search(/\b(with|select)\b/i);
  if (start < 0) return null;
  sql = sql.slice(start).trim();
  return sql.replace(/;\s*$/, '').trim() || null;
}

function sqlFromMessage(msg: BaseMessage): string | null {
  const args = extractToolArgs(msg, 'run_readonly_query');
  if (args && typeof args.sql === 'string' && args.sql.trim()) return args.sql.trim();
  return extractSqlFromText(contentText(msg));
}

const normalizeSql = (s: string) =>
  s.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim().toLowerCase();

// ---------- graph ----------

const AgentState = Annotation.Root({
  question: Annotation<string>(),
  tables: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  schemaText: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  pendingSql: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  attempts: Annotation<Attempt[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  retries: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  lastResult: Annotation<RunQueryOutput | null>({ reducer: (_a, b) => b, default: () => null }),
  route: Annotation<'answer' | 'retry' | 'give_up' | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  finalAnswer: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  status: Annotation<AgentResult['status']>({ reducer: (_a, b) => b, default: () => 'answered' }),
  inputTokens: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  outputTokens: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
});

type State = typeof AgentState.State;

export function buildAgentGraph(opts: AgentOptions) {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const variant = opts.promptVariant ?? 'B';
  const tools = makeTools({
    workspace: opts.workspace,
    model: opts.model,
    schemaOptions: opts.schemaOptions,
  });
  const emit = async (step: AgentStep) => {
    if (opts.onStep) await opts.onStep(step);
  };

  const plan = async (state: State) => {
    const started = Date.now();
    const available = await listTables(opts.workspace);
    if (available.length === 0) {
      await emit({
        type: 'plan',
        message: 'No tables in this workspace',
        latencyMs: Date.now() - started,
      });
      return {
        route: 'give_up' as const,
        finalAnswer: 'This workspace has no tables yet. Upload a CSV first.',
      };
    }
    const tableList = available.map((t) => `- ${t.table} (${t.rowCount} rows)`).join('\n');
    const messages = planMessages(state.question, tableList);
    const response = await opts.model.bindTools!([tools.getSchema]).invoke(messages);
    const args = extractToolArgs(response, 'get_schema');
    const names = new Set(available.map((t) => t.table));
    const requested = Array.isArray(args?.tables)
      ? (args!.tables as string[]).filter((t) => names.has(t))
      : [];
    const tables = requested.length ? requested : [...names];
    const usage = usageOf(response);
    await emit({
      type: 'plan',
      message: `Reading schema for ${tables.join(', ')}`,
      prompt: promptText(messages),
      toolName: 'get_schema',
      toolInput: { tables },
      latencyMs: Date.now() - started,
      ...usage,
    });
    return { tables, inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 };
  };

  const getSchema = async (state: State) => {
    const started = Date.now();
    const schemaText = String(await tools.getSchema.invoke({ tables: state.tables }));
    await emit({
      type: 'get_schema',
      message: `Read ${state.tables.length} table schema(s)`,
      toolName: 'get_schema',
      toolInput: { tables: state.tables },
      toolOutput: schemaText,
      latencyMs: Date.now() - started,
    });
    return { schemaText };
  };

  const writeSql = async (state: State) => {
    const started = Date.now();
    const messages = writeSqlMessages(variant, state.question, state.schemaText, state.attempts);
    const response = await opts.model.bindTools!([tools.runQuery]).invoke(messages);
    const sql = sqlFromMessage(response);
    const usage = usageOf(response);
    await emit({
      type: 'write_sql',
      message: state.attempts.length
        ? `Retrying (attempt ${state.attempts.length + 1})`
        : 'Writing SQL',
      prompt: promptText(messages),
      toolName: 'run_readonly_query',
      toolInput: { sql },
      error: sql ? undefined : 'Model did not return a SQL query',
      latencyMs: Date.now() - started,
      ...usage,
    });
    const tokens = { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 };
    if (!sql) {
      return {
        pendingSql: null,
        lastResult: null,
        attempts: [
          {
            sql: '(none)',
            code: 'NO_SQL',
            error: 'No SQL query was submitted. Call run_readonly_query.',
          },
        ],
        ...tokens,
      };
    }
    return { pendingSql: sql, ...tokens };
  };

  const runSql = async (state: State) => {
    if (!state.pendingSql) return {};
    const started = Date.now();
    const output = (await tools.runQuery.invoke({ sql: state.pendingSql })) as RunQueryOutput;
    const attempt: Attempt = output.ok
      ? { sql: state.pendingSql, rowCount: output.rowCount }
      : { sql: state.pendingSql, code: output.code, error: output.error };
    await emit({
      type: 'run_sql',
      message: output.ok
        ? `Query returned ${output.rowCount} row(s)`
        : `Query failed: ${output.error}`,
      toolName: 'run_readonly_query',
      toolInput: { sql: state.pendingSql },
      toolOutput: output.ok
        ? {
            rowCount: output.rowCount,
            columns: output.columns,
            rows: output.rows.slice(0, 5),
            hasMore: output.hasMore,
          }
        : output,
      error: output.ok ? undefined : output.error,
      latencyMs: Date.now() - started,
    });
    return { attempts: [attempt], lastResult: output, pendingSql: null };
  };

  const checkResult = async (state: State) => {
    const last = state.attempts[state.attempts.length - 1];
    const prev = state.attempts[state.attempts.length - 2];
    let route: 'answer' | 'retry' | 'give_up';
    let reason: string;
    const succeeded = !last.error && state.lastResult?.ok;

    if (succeeded && (last.rowCount ?? 0) > 0) {
      route = 'answer';
      reason = 'Result looks good';
    } else if (succeeded) {
      // Empty result: retry once with a hint, unless the model stands by the same query.
      const confirmed =
        prev &&
        !prev.error &&
        prev.rowCount === 0 &&
        normalizeSql(prev.sql) === normalizeSql(last.sql);
      if (confirmed || state.retries >= maxRetries) {
        route = 'answer';
        reason = confirmed
          ? 'Empty result confirmed by the model'
          : 'Empty result after the retry limit';
      } else {
        route = 'retry';
        reason = 'Empty result, asking the model to double-check';
      }
    } else if (state.retries < maxRetries) {
      route = 'retry';
      reason = `Error, retrying (${state.retries + 1} of ${maxRetries})`;
    } else {
      route = 'give_up';
      reason = `Still failing after ${maxRetries} retries`;
    }
    await emit({ type: 'check_result', message: reason, latencyMs: 0 });
    return { route, retries: route === 'retry' ? state.retries + 1 : state.retries };
  };

  const answer = async (state: State) => {
    const started = Date.now();
    const result = state.lastResult;
    const sql = state.attempts[state.attempts.length - 1].sql;
    if (!result || !result.ok || result.rowCount === 0) {
      const text = 'No matching rows were found.';
      await emit({ type: 'answer', message: text, latencyMs: Date.now() - started });
      return { finalAnswer: text, status: 'answered' as const };
    }
    const output = (await tools.summarizeResult.invoke({
      question: state.question,
      sql,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      hasMore: result.hasMore,
    })) as { answer: string; usage: { input_tokens?: number; output_tokens?: number } | null };
    await emit({
      type: 'answer',
      message: output.answer,
      toolName: 'summarize_result',
      toolOutput: { answer: output.answer },
      latencyMs: Date.now() - started,
      inputTokens: output.usage?.input_tokens,
      outputTokens: output.usage?.output_tokens,
    });
    return {
      finalAnswer: output.answer,
      status: 'answered' as const,
      inputTokens: output.usage?.input_tokens ?? 0,
      outputTokens: output.usage?.output_tokens ?? 0,
    };
  };

  const giveUp = async (state: State) => {
    const last = state.attempts[state.attempts.length - 1];
    const text =
      state.finalAnswer ||
      `I could not answer this after ${state.attempts.length} attempt(s). Last error: ${last?.error ?? 'unknown'}`;
    await emit({ type: 'give_up', message: text, error: last?.error, latencyMs: 0 });
    return { finalAnswer: text, status: 'gave_up' as const };
  };

  return new StateGraph(AgentState)
    .addNode('plan', plan)
    .addNode('get_schema', getSchema)
    .addNode('write_sql', writeSql)
    .addNode('run_sql', runSql)
    .addNode('check_result', checkResult)
    .addNode('answer', answer)
    .addNode('give_up', giveUp)
    .addEdge(START, 'plan')
    .addConditionalEdges('plan', (s: State) => (s.route === 'give_up' ? 'give_up' : 'get_schema'), [
      'give_up',
      'get_schema',
    ])
    .addEdge('get_schema', 'write_sql')
    .addEdge('write_sql', 'run_sql')
    .addEdge('run_sql', 'check_result')
    .addConditionalEdges(
      'check_result',
      (s: State) =>
        s.route === 'retry' ? 'write_sql' : s.route === 'answer' ? 'answer' : 'give_up',
      ['write_sql', 'answer', 'give_up']
    )
    .addEdge('answer', END)
    .addEdge('give_up', END)
    .compile();
}

export async function runAgent(question: string, opts: AgentOptions): Promise<AgentResult> {
  const graph = buildAgentGraph(opts);
  try {
    const state = (await graph.invoke({ question }, { recursionLimit: 50 })) as State;
    const last = state.lastResult;
    const success = last && last.ok;
    const lastAttempt = state.attempts[state.attempts.length - 1];
    return {
      status: state.status,
      answer: state.finalAnswer,
      sql: lastAttempt && lastAttempt.sql !== '(none)' ? lastAttempt.sql : null,
      columns: success ? last.columns : [],
      rows: success ? last.rows : [],
      rowCount: success ? last.rowCount : 0,
      hasMore: success ? last.hasMore : false,
      attempts: state.attempts,
      retries: state.retries,
      usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens },
    };
  } catch (err) {
    return {
      status: 'error',
      answer: '',
      sql: null,
      columns: [],
      rows: [],
      rowCount: 0,
      hasMore: false,
      attempts: [],
      retries: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      error: (err as Error).message,
    };
  }
}

/** Baseline: the original single-shot NL-to-SQL (one prompt, one query, no retries). */
export async function runSingleShot(
  question: string,
  opts: Pick<AgentOptions, 'workspace' | 'model' | 'schemaOptions' | 'onStep'>
): Promise<AgentResult> {
  const tools = makeTools({ workspace: opts.workspace, model: opts.model });
  const base: AgentResult = {
    status: 'error',
    answer: '',
    sql: null,
    columns: [],
    rows: [],
    rowCount: 0,
    hasMore: false,
    attempts: [],
    retries: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  try {
    const started = Date.now();
    const schemaText = schemaToText(await getWorkspaceSchema(opts.workspace, opts.schemaOptions));
    const messages = singleShotMessages(question, schemaText);
    const response = await opts.model.invoke(messages);
    const usage = usageOf(response);
    const sql = extractSqlFromText(contentText(response));
    if (opts.onStep) {
      await opts.onStep({
        type: 'write_sql',
        message: 'Single-shot SQL',
        prompt: promptText(messages),
        toolInput: { sql },
        latencyMs: Date.now() - started,
        ...usage,
      });
    }
    base.usage = { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 };
    if (!sql) return { ...base, error: 'Model did not return a SQL query' };

    const runStarted = Date.now();
    const output = (await tools.runQuery.invoke({ sql })) as RunQueryOutput;
    if (opts.onStep) {
      await opts.onStep({
        type: 'run_sql',
        message: output.ok
          ? `Query returned ${output.rowCount} row(s)`
          : `Query failed: ${output.error}`,
        toolName: 'run_readonly_query',
        toolInput: { sql },
        error: output.ok ? undefined : output.error,
        latencyMs: Date.now() - runStarted,
      });
    }
    if (!output.ok) {
      return {
        ...base,
        sql,
        attempts: [{ sql, code: output.code, error: output.error }],
        error: output.error,
      };
    }
    return {
      ...base,
      status: 'answered',
      sql,
      columns: output.columns,
      rows: output.rows,
      rowCount: output.rowCount,
      hasMore: output.hasMore,
      attempts: [{ sql, rowCount: output.rowCount }],
    };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}
