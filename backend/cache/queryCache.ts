// Cache for read-only query results.
// Key = workspace id + workspace data version + SHA-256 of (sql, page, pageSize). Every upload or
// delete bumps the workspace's data_version, so old entries are never read again after the data
// changes; the TTL (QUERY_CACHE_TTL_SECONDS, default 300, 0 disables) cleans them up.
import crypto from 'crypto';
import { runReadonlyQuery, type QueryResult } from '../services/readonlyQuery';
import type { Workspace } from '../services/workspaceService';
import { getStore } from './store';

export function cacheTtlSeconds(): number {
  return Number(process.env.QUERY_CACHE_TTL_SECONDS ?? 300);
}

export function cacheKey(
  workspace: Workspace,
  sql: string,
  page: number,
  pageSize: number
): string {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([sql.trim(), page, pageSize]))
    .digest('hex');
  return `qc:${workspace.id}:v${workspace.dataVersion}:${digest}`;
}

const stats = { hits: 0, misses: 0 };
export function cacheStats() {
  return { ...stats };
}

export async function runCachedQuery(
  sql: string,
  workspace: Workspace,
  opts: { page?: number; pageSize?: number } = {}
): Promise<QueryResult & { cached: boolean }> {
  const ttl = cacheTtlSeconds();
  if (ttl <= 0) return { ...(await runReadonlyQuery(sql, workspace, opts)), cached: false };

  const page = Math.max(1, Math.floor(Number(opts.page) || 1));
  const pageSize = Math.floor(Number(opts.pageSize) || 100);
  const key = cacheKey(workspace, sql, page, pageSize);
  const store = getStore();

  try {
    const hit = await store.get(key);
    if (hit) {
      stats.hits++;
      return { ...(JSON.parse(hit) as QueryResult), cached: true };
    }
  } catch {
    // A cache outage must not break queries; fall through to the database.
  }
  stats.misses++;
  const result = await runReadonlyQuery(sql, workspace, { page, pageSize });
  // Only successful results are cached; errors and timeouts are retried against the database.
  if (result.success) await store.set(key, JSON.stringify(result), ttl).catch(() => {});
  return { ...result, cached: false };
}
