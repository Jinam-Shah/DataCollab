// Second pass: create the table and stream rows into it in batches, inside one transaction.
// Safe to retry: a failed attempt rolls back completely, and a new attempt starts from scratch.
import fs from 'fs';
import type { PoolClient } from 'pg';
import { profileCsv, type ProfiledColumn, type QualityReport } from './profile';
import { ensureWorkspace, bumpDataVersion, quoteIdent } from '../services/workspaceService';
const csv = require('csv-parser');
const pool = require('../config/database');
const CSVService = require('../services/csvService');

export interface IngestJob {
  fileId: number;
  workspaceSlug: string;
  filePath: string;
}

export interface IngestProgress {
  fileId: number;
  phase: 'profiling' | 'loading' | 'done';
  rowsLoaded: number;
  totalRows: number;
  percent: number;
}

export interface IngestResult {
  fileId: number;
  tableName: string;
  rowCount: number;
  columnCount: number;
  report: QualityReport;
  ingestMs: number;
}

const BATCH_ROWS = Number(process.env.INGEST_BATCH_ROWS || 1000);

async function insertBatch(
  client: PoolClient,
  target: string,
  columns: ProfiledColumn[],
  rows: Record<string, string>[]
): Promise<void> {
  const values: unknown[] = [];
  const placeholders = rows.map((row, r) => {
    const ph = columns.map((col, c) => {
      values.push(CSVService.convertValue(row[col.name], col));
      return `$${r * columns.length + c + 1}`;
    });
    return `(${ph.join(', ')})`;
  });
  const names = columns.map((c) => quoteIdent(c.sqlName)).join(', ');
  await client.query(`INSERT INTO ${target} (${names}) VALUES ${placeholders.join(', ')}`, values);
}

export async function ingestFile(
  job: IngestJob,
  onProgress: (p: IngestProgress) => void | Promise<void> = () => {}
): Promise<IngestResult> {
  const started = Date.now();
  const { fileId, filePath } = job;
  if (!fs.existsSync(filePath)) throw new Error(`Uploaded file is missing: ${filePath}`);

  const workspace = await ensureWorkspace(job.workspaceSlug);
  const fileRow = await pool.query('SELECT table_name FROM csv_files WHERE id = $1', [fileId]);
  if (!fileRow.rows[0]) throw new Error(`File ${fileId} no longer exists`);
  const tableName: string = fileRow.rows[0].table_name;

  await pool.query("UPDATE csv_files SET status = 'processing', error = NULL WHERE id = $1", [
    fileId,
  ]);
  await onProgress({ fileId, phase: 'profiling', rowsLoaded: 0, totalRows: 0, percent: 0 });

  const { columns, rowCount, report } = await profileCsv(filePath);
  if (rowCount === 0 || columns.length === 0) throw new Error('CSV file is empty');

  const target = `${quoteIdent(workspace.schemaName)}.${quoteIdent(tableName)}`;
  // Stay under PostgreSQL's 65535 bind-parameter limit per statement.
  const batchRows = Math.max(1, Math.min(BATCH_ROWS, Math.floor(65535 / columns.length)));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DROP TABLE IF EXISTS ${target}`);
    await client.query('DELETE FROM csv_columns WHERE file_id = $1', [fileId]);
    for (const col of columns) {
      await client.query(
        `INSERT INTO csv_columns (file_id, column_name, data_type, column_index, sample_values)
         VALUES ($1, $2, $3, $4, $5)`,
        [fileId, col.sqlName, col.type, col.index, col.samples]
      );
    }
    await CSVService.createDataTable(workspace.schemaName, tableName, columns, client);

    let batch: Record<string, string>[] = [];
    let loaded = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      await insertBatch(client, target, columns, batch);
      loaded += batch.length;
      batch = [];
      await onProgress({
        fileId,
        phase: 'loading',
        rowsLoaded: loaded,
        totalRows: rowCount,
        percent: Math.floor((loaded / rowCount) * 100),
      });
    };
    const stream = fs.createReadStream(filePath).pipe(csv({ strict: false }));
    for await (const row of stream as AsyncIterable<Record<string, string>>) {
      batch.push(row);
      if (batch.length >= batchRows) await flush();
    }
    await flush();

    const ingestMs = Date.now() - started;
    await client.query(
      `UPDATE csv_files
          SET status = 'ready', row_count = $2, column_count = $3, processed_rows = $2,
              quality_report = $4, ingest_ms = $5, error = NULL
        WHERE id = $1`,
      [fileId, rowCount, columns.length, JSON.stringify(report), ingestMs]
    );
    await bumpDataVersion(workspace.id, client);
    await client.query('COMMIT');

    await onProgress({
      fileId,
      phase: 'done',
      rowsLoaded: loaded,
      totalRows: rowCount,
      percent: 100,
    });
    return { fileId, tableName, rowCount, columnCount: columns.length, report, ingestMs };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function markFailed(fileId: number, message: string): Promise<void> {
  await pool.query("UPDATE csv_files SET status = 'failed', error = $2 WHERE id = $1", [
    fileId,
    message,
  ]);
}
