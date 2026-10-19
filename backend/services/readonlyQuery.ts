// Runs user- and agent-written SQL safely.
//
// 1. sqlGuard checks the text is exactly one SELECT that only names the workspace's schema.
// 2. The query runs on a separate pool that logs in as the read-only role (DATABASE_READER_URL).
// 3. Inside a READ ONLY transaction we SET LOCAL ROLE to the workspace role, so the query can
//    only see that workspace's tables, and set search_path to the workspace schema.
// 4. The statement is wrapped in a LIMIT/OFFSET so at most `pageSize` rows come back.
// 5. The extended query protocol is used, which the server refuses for multi-statement strings.
import { Pool } from 'pg';
import { checkSql, type GuardErrorCode } from '../security/sqlGuard';
import { quoteIdent, type Workspace } from './workspaceService';

export const MAX_PAGE_SIZE = 1000;
export const DEFAULT_PAGE_SIZE = 100;

export type QueryErrorCode = GuardErrorCode | 'TIMEOUT' | 'PERMISSION_DENIED' | 'DB_ERROR';

export interface QuerySuccess {
  success: true;
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  executionTime: number;
  sql: string;
}

export interface QueryFailure {
  success: false;
  code: QueryErrorCode;
  error: string;
  executionTime: number;
}

export type QueryResult = QuerySuccess | QueryFailure;

let readerPool: Pool | null = null;

export function getReaderPool(): Pool {
  if (!readerPool) {
    const connectionString = process.env.DATABASE_READER_URL;
    if (!connectionString) throw new Error('DATABASE_READER_URL is not configured');
    readerPool = new Pool({ connectionString, max: Number(process.env.READER_POOL_MAX || 5) });
    readerPool.on('error', (err) => console.error('Reader pool error:', err.message));
  }
  return readerPool;
}

export async function closeReaderPool(): Promise<void> {
  if (readerPool) await readerPool.end();
  readerPool = null;
}

function statementTimeoutMs(): number {
  return Number(process.env.QUERY_TIMEOUT_MS || 5000);
}

function classifyDbError(err: { code?: string; message: string }): {
  code: QueryErrorCode;
  error: string;
} {
  if (err.code === '57014') {
    return { code: 'TIMEOUT', error: `Query timed out after ${statementTimeoutMs() / 1000}s` };
  }
  if (err.code === '42501') return { code: 'PERMISSION_DENIED', error: err.message };
  if (err.code === '25006') {
    return { code: 'PERMISSION_DENIED', error: 'Query tried to write in a read-only transaction' };
  }
  return { code: 'DB_ERROR', error: err.message };
}

export async function runReadonlyQuery(
  sql: string,
  workspace: Workspace,
  opts: { page?: number; pageSize?: number } = {}
): Promise<QueryResult> {
  const start = Date.now();
  const page = Math.max(1, Math.floor(Number(opts.page) || 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(Number(opts.pageSize) || DEFAULT_PAGE_SIZE))
  );

  const check = await checkSql(sql, { schema: workspace.schemaName });
  if (!check.ok) {
    return { success: false, code: check.code, error: check.message, executionTime: 0 };
  }

  // Newlines keep a trailing `-- comment` in the user's SQL from swallowing the wrapper.
  const offset = (page - 1) * pageSize;
  const wrapped = `SELECT * FROM (\n${check.sql}\n) AS dc_result LIMIT ${pageSize + 1} OFFSET ${offset}`;

  const client = await getReaderPool().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL ROLE ${quoteIdent(workspace.roleName)}`);
    await client.query(`SET LOCAL search_path TO ${quoteIdent(workspace.schemaName)}`);
    await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs()}`);
    const result = await client.query({ text: wrapped, queryMode: 'extended' } as never);
    await client.query('COMMIT');

    const rows = (result as { rows: Record<string, unknown>[] }).rows;
    const fields = (result as { fields?: { name: string }[] }).fields ?? [];
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    return {
      success: true,
      rows: pageRows,
      columns: fields.map((f) => f.name),
      rowCount: pageRows.length,
      page,
      pageSize,
      hasMore,
      executionTime: Date.now() - start,
      sql: check.sql,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return {
      success: false,
      ...classifyDbError(err as { code?: string; message: string }),
      executionTime: Date.now() - start,
    };
  } finally {
    client.release();
  }
}
