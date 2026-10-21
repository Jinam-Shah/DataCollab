// LangChain tools the agent can call through Gemini function calling. Each has a zod schema,
// which LangChain turns into the JSON schema sent to the model.
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Workspace } from '../services/workspaceService';
import { runReadonlyQuery } from '../services/readonlyQuery';
import { getWorkspaceSchema, schemaToText, type SchemaOptions } from './schema';
import { summarizePrompt } from './prompts';
import { searchDocuments as searchStore } from '../rag/store';

export const AGENT_ROW_LIMIT = 50;

// Limits a run to the tables and documents the user picked. Undefined means everything in the
// workspace; an empty list means none of that kind.
export interface AgentScope {
  tables?: string[];
  documentIds?: number[];
}

export interface ToolContext {
  workspace: Workspace;
  model: BaseChatModel;
  schemaOptions?: SchemaOptions;
  scope?: AgentScope;
}

// Tables the model asked for, kept inside the scope. Asking for none means the whole scope.
export function scopedTables(requested: string[] | undefined, scope?: AgentScope) {
  if (!scope?.tables) return requested;
  const inScope = (requested ?? []).filter((t) => scope.tables!.includes(t));
  return inScope.length ? inScope : scope.tables;
}

export const getSchemaInput = z.object({
  tables: z
    .array(z.string())
    .optional()
    .describe('Table names to describe. Omit to describe every table in the workspace.'),
});

export const runQueryInput = z.object({
  sql: z.string().describe('Exactly one PostgreSQL SELECT statement.'),
  reasoning: z.string().optional().describe('One sentence on how the query answers the question.'),
});

export const summarizeInput = z.object({
  question: z.string(),
  sql: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number(),
  hasMore: z.boolean().optional(),
  excerpts: z.string().optional(),
});

export const searchDocumentsInput = z.object({
  query: z
    .string()
    .describe('What to look for in the uploaded documents, as a short search query.'),
  k: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('How many passages to return (default 5).'),
});

export type RunQueryOutput =
  | {
      ok: true;
      rows: Record<string, unknown>[];
      columns: string[];
      rowCount: number;
      hasMore: boolean;
      executionMs: number;
    }
  | { ok: false; code: string; error: string; executionMs: number };

export function makeTools(ctx: ToolContext) {
  const getSchema = tool(
    async ({ tables }) => {
      // getWorkspaceSchema reads an empty list as "all tables", so handle "none selected" here.
      if (ctx.scope?.tables && ctx.scope.tables.length === 0) return 'No tables were selected.';
      const schema = await getWorkspaceSchema(ctx.workspace, {
        ...ctx.schemaOptions,
        tables: scopedTables(tables, ctx.scope),
      });
      return schemaToText(schema);
    },
    {
      name: 'get_schema',
      description:
        'Describe tables in this workspace: column names, types, sample values and column descriptions.',
      schema: getSchemaInput,
    }
  );

  const runQuery = tool(
    async ({ sql }): Promise<RunQueryOutput> => {
      const result = await runReadonlyQuery(sql, ctx.workspace, { pageSize: AGENT_ROW_LIMIT });
      if (!result.success) {
        return {
          ok: false,
          code: result.code,
          error: result.error,
          executionMs: result.executionTime,
        };
      }
      return {
        ok: true,
        rows: result.rows,
        columns: result.columns,
        rowCount: result.rowCount,
        hasMore: result.hasMore,
        executionMs: result.executionTime,
      };
    },
    {
      name: 'run_readonly_query',
      description:
        'Run one read-only SELECT against the workspace tables. Returns up to 50 rows, or a structured error.',
      schema: runQueryInput,
    }
  );

  const summarizeResult = tool(
    async (input) => {
      const response = await ctx.model.invoke(summarizePrompt(input));
      return {
        answer: String(response.content).trim(),
        usage: response.usage_metadata ?? null,
      };
    },
    {
      name: 'summarize_result',
      description: 'Turn a query result into a short plain-English answer with the key numbers.',
      schema: summarizeInput,
    }
  );

  const searchDocuments = tool(
    async ({ query, k }) =>
      searchStore(ctx.workspace.slug, query, {
        mode: 'hybrid',
        k: k ?? 5,
        documentIds: ctx.scope?.documentIds ?? null,
      }),
    {
      name: 'search_documents',
      description:
        'Search the documents uploaded to this workspace (data dictionaries, reports, PDFs) with ' +
        'hybrid keyword + semantic search. Returns numbered passages with their source.',
      schema: searchDocumentsInput,
    }
  );

  return { getSchema, runQuery, summarizeResult, searchDocuments };
}
