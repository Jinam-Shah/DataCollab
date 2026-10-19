// DataCollab as a Model Context Protocol server. One server instance is bound to one workspace
// (resolved from an API token), and every tool goes through the same safety layer as the app.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Workspace } from '../services/workspaceService';
import { runReadonlyQuery } from '../services/readonlyQuery';
import { getWorkspaceSchema, listTables, schemaToText } from '../agent/schema';
import { searchDocuments } from '../rag/store';

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});
const failure = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
});

export function createMcpServer(workspace: Workspace): McpServer {
  const server = new McpServer(
    { name: 'datacollab', version: '1.0.0' },
    {
      instructions:
        `Tools for the DataCollab workspace "${workspace.slug}". Call list_tables, then describe_table, ` +
        'then run_readonly_query with one PostgreSQL SELECT. Use search_documents for uploaded documents.',
    }
  );

  server.registerTool(
    'list_tables',
    {
      title: 'List tables',
      description: 'List the tables in this workspace with their row counts.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => json({ workspace: workspace.slug, tables: await listTables(workspace) })
  );

  server.registerTool(
    'describe_table',
    {
      title: 'Describe a table',
      description: 'Column names, types, sample values and statistics for one table.',
      inputSchema: { table: z.string().describe('Table name from list_tables') },
      annotations: { readOnlyHint: true },
    },
    async ({ table }) => {
      const schema = await getWorkspaceSchema(workspace, {
        tables: [table],
        includeProfiles: true,
      });
      if (schema.length === 0) return failure(`Table "${table}" was not found in this workspace`);
      return { content: [{ type: 'text' as const, text: schemaToText(schema) }] };
    }
  );

  server.registerTool(
    'run_readonly_query',
    {
      title: 'Run a read-only SQL query',
      description:
        'Run exactly one PostgreSQL SELECT against this workspace. Read-only, 5 s timeout, at most 1000 rows per page.',
      inputSchema: {
        sql: z.string().describe('One SELECT statement'),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(1000).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ sql, page, pageSize }) => {
      const result = await runReadonlyQuery(sql, workspace, { page, pageSize: pageSize ?? 100 });
      if (!result.success) return failure(`${result.code}: ${result.error}`);
      return json({
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        page: result.page,
        hasMore: result.hasMore,
        executionMs: result.executionTime,
      });
    }
  );

  server.registerTool(
    'search_documents',
    {
      title: 'Search documents',
      description: 'Hybrid keyword + semantic search over documents uploaded to this workspace.',
      inputSchema: {
        query: z.string(),
        k: z.number().int().min(1).max(20).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, k }) => {
      const hits = await searchDocuments(workspace.slug, query, { k: k ?? 5 });
      return json(
        hits.map((h) => ({
          filename: h.filename,
          page: h.page,
          section: h.section,
          content: h.content,
          score: Number(h.score.toFixed(4)),
        }))
      );
    }
  );

  return server;
}
