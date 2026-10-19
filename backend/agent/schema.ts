// Builds the workspace schema description that the agent's get_schema tool returns.
import type { Workspace } from '../services/workspaceService';
const pool = require('../config/database');

export interface SchemaColumn {
  name: string;
  type: string;
  samples: string[];
  description: string | null;
  profile: string | null;
}

export interface SchemaTable {
  table: string;
  file: string;
  rowCount: number;
  columns: SchemaColumn[];
}

export interface SchemaOptions {
  tables?: string[];
  // Add per-column statistics from the upload quality report (range, % empty, distinct values).
  includeProfiles?: boolean;
}

interface QualityColumn {
  sqlName: string;
  emptyPct: number;
  min: unknown;
  max: unknown;
  distinctSampled: number;
}

function profileText(q: QualityColumn | undefined, samples: string[]): string | null {
  if (!q) return null;
  const parts: string[] = [];
  if (q.min !== null && q.min !== undefined) parts.push(`range ${q.min} to ${q.max}`);
  if (q.emptyPct > 0) parts.push(`${q.emptyPct}% empty`);
  if (q.distinctSampled > 0 && q.distinctSampled <= 12) {
    const distinct = [...new Set(samples.filter(Boolean))];
    parts.push(
      `${q.distinctSampled} distinct values${distinct.length ? ` (e.g. ${distinct.join(', ')})` : ''}`
    );
  }
  return parts.length ? parts.join('; ') : null;
}

export async function listTables(
  workspace: Workspace
): Promise<{ table: string; rowCount: number }[]> {
  const { rows } = await pool.query(
    `SELECT table_name, row_count FROM csv_files
      WHERE workspace_id = $1 AND status = 'ready' ORDER BY table_name`,
    [workspace.slug]
  );
  return rows.map((r: { table_name: string; row_count: number }) => ({
    table: r.table_name,
    rowCount: r.row_count,
  }));
}

export async function getWorkspaceSchema(
  workspace: Workspace,
  opts: SchemaOptions = {}
): Promise<SchemaTable[]> {
  const { rows } = await pool.query(
    `SELECT f.id, f.table_name, f.original_filename, f.row_count, f.quality_report,
            c.column_name, c.data_type, c.sample_values, c.description
       FROM csv_files f
       JOIN csv_columns c ON c.file_id = f.id
      WHERE f.workspace_id = $1 AND f.status = 'ready'
        AND ($2::text[] IS NULL OR f.table_name = ANY($2))
      ORDER BY f.table_name, c.column_index`,
    [workspace.slug, opts.tables && opts.tables.length ? opts.tables : null]
  );

  const tables = new Map<string, SchemaTable>();
  for (const r of rows) {
    let t = tables.get(r.table_name);
    if (!t) {
      t = { table: r.table_name, file: r.original_filename, rowCount: r.row_count, columns: [] };
      tables.set(r.table_name, t);
    }
    const quality = (r.quality_report?.columns as QualityColumn[] | undefined)?.find(
      (q) => q.sqlName === r.column_name
    );
    const samples: string[] = (r.sample_values || []).slice(0, 5);
    t.columns.push({
      name: r.column_name,
      type: r.data_type,
      samples,
      description: r.description,
      profile: opts.includeProfiles ? profileText(quality, samples) : null,
    });
  }
  return [...tables.values()];
}

/** Compact text form used inside prompts. */
export function schemaToText(tables: SchemaTable[]): string {
  if (tables.length === 0) return '(this workspace has no tables yet)';
  return tables
    .map((t) => {
      const cols = t.columns
        .map((c) => {
          const extra = [c.description, c.profile].filter(Boolean).join('; ');
          const samples = c.samples.filter((s) => s !== '').slice(0, 3);
          return `  - "${c.name}" ${c.type}${samples.length ? ` e.g. ${samples.map((s) => JSON.stringify(s)).join(', ')}` : ''}${extra ? ` -- ${extra}` : ''}`;
        })
        .join('\n');
      return `Table "${t.table}" (${t.rowCount} rows, from ${t.file}):\n${cols}`;
    })
    .join('\n\n');
}
