const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const CSVService = require('../services/csvService');
const { UPLOAD_DIR } = require('../config/paths');
const { ensureWorkspace, bumpDataVersion, quoteIdent } = require('../services/workspaceService');
const { getFileForWorkspace } = require('../services/fileAccess');
const { ingestFile } = require('../ingest/ingestFile');
const { enqueueIngest } = require('../ingest/queue');

function removeUpload(filePath) {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// Files up to this size are loaded during the request; larger ones go to the background queue.
const INLINE_UPLOAD_MAX_BYTES = Number(process.env.INLINE_UPLOAD_MAX_BYTES || 1024 * 1024);

// Upload a CSV. Small files: loaded now, 201 with the quality report.
// Large files: 202 with a job id; progress arrives as `file:progress` socket events.
exports.uploadCSV = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const { originalname, filename, size, path: filePath } = req.file;
  let fileId = null;

  try {
    const workspace = await ensureWorkspace(req.workspaceId);
    const tableName = await CSVService.uniqueTableName(workspace.slug, originalname);
    const { rows } = await pool.query(
      `INSERT INTO csv_files (user_id, original_filename, stored_filename, file_size,
                              workspace_id, table_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued')
       RETURNING id`,
      [req.userId, originalname, filename, size, workspace.slug, tableName]
    );
    fileId = rows[0].id;
    const job = { fileId, workspaceSlug: workspace.slug, filePath };
    const announce = {
      fileId,
      filename: originalname,
      username: req.username,
      tableName,
    };

    if (size > INLINE_UPLOAD_MAX_BYTES) {
      const jobId = await enqueueIngest(job);
      await pool.query('UPDATE csv_files SET job_id = $2 WHERE id = $1', [fileId, jobId]);
      req.app.get('broadcast')(workspace.slug, 'file:uploaded', { ...announce, status: 'queued' });
      return res.status(202).json({
        message: 'File accepted for background processing',
        jobId,
        file: { id: fileId, originalFilename: originalname, tableName, status: 'queued' },
      });
    }

    const result = await ingestFile(job);
    const preview = await CSVService.getPreview(workspace.schemaName, tableName, 10);
    const columns = await pool.query(
      'SELECT column_name, data_type FROM csv_columns WHERE file_id = $1 ORDER BY column_index',
      [fileId]
    );

    req.app.get('broadcast')(workspace.slug, 'file:uploaded', {
      ...announce,
      status: 'ready',
      rowCount: result.rowCount,
      columnCount: result.columnCount,
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        id: fileId,
        originalFilename: originalname,
        status: 'ready',
        rowCount: result.rowCount,
        columnCount: result.columnCount,
        columns: columns.rows.map((c) => ({ name: c.column_name, type: c.data_type })),
        tableName,
        qualityReport: result.report,
        preview,
      },
    });
  } catch (error) {
    // Inline failures leave nothing behind; the client can fix the file and retry.
    if (fileId) await pool.query('DELETE FROM csv_files WHERE id = $1', [fileId]).catch(() => {});
    removeUpload(filePath);
    if (error.message === 'CSV file is empty') {
      return res.status(400).json({ error: 'CSV file is empty' });
    }
    console.error('Upload error:', error);
    res.status(500).json({ error: 'File upload failed', details: error.message });
  }
};

// Get all uploaded files
exports.getFiles = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.original_filename, f.file_size, f.row_count, f.column_count,
              f.uploaded_at, f.table_name, f.status, f.error, u.username
         FROM csv_files f
         JOIN users u ON f.user_id = u.id
        WHERE f.workspace_id = $1
        ORDER BY f.uploaded_at DESC`,
      [req.workspaceId]
    );
    res.json({ files: result.rows });
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Failed to get files' });
  }
};

// Get file details including columns
exports.getFileDetails = async (req, res) => {
  try {
    const file = await getFileForWorkspace(req.params.id, req.workspaceId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const columnsResult = await pool.query(
      `SELECT column_name, data_type, column_index, sample_values
         FROM csv_columns WHERE file_id = $1 ORDER BY column_index`,
      [file.id]
    );
    const ready = file.status === 'ready';
    const preview = ready ? await CSVService.getPreview(file.schema_name, file.table_name, 10) : [];

    res.json({
      file: {
        id: file.id,
        originalFilename: file.original_filename,
        fileSize: file.file_size,
        rowCount: file.row_count,
        columnCount: file.column_count,
        uploadedAt: file.uploaded_at,
        username: file.username,
        tableName: file.table_name,
        status: file.status,
        error: file.error,
        processedRows: file.processed_rows,
        ingestMs: file.ingest_ms,
        qualityReport: file.quality_report,
        columns: columnsResult.rows.map((col) => ({ name: col.column_name, type: col.data_type })),
        preview,
      },
    });
  } catch (error) {
    console.error('Get file details error:', error);
    res.status(500).json({ error: 'Failed to get file details' });
  }
};

// Column list for reading a table back: sanitized SQL names plus the header text from the
// original file (kept in the quality report), so a download has the same headers as the upload.
async function tableColumns(file) {
  const { rows } = await pool.query(
    'SELECT column_name FROM csv_columns WHERE file_id = $1 ORDER BY column_index',
    [file.id]
  );
  const original = new Map((file.quality_report?.columns || []).map((c) => [c.sqlName, c.name]));
  return rows.map((r) => ({
    sql: r.column_name,
    header: original.get(r.column_name) ?? r.column_name,
  }));
}

// Values are read as text so dates and numbers come back exactly as PostgreSQL prints them.
const selectAsText = (file, columns, extra = null) =>
  `SELECT ${extra ? `${extra}, ` : ''}${columns
    .map((c) => `${quoteIdent(c.sql)}::text AS ${quoteIdent(c.sql)}`)
    .join(', ')}
     FROM ${quoteIdent(file.schema_name)}.${quoteIdent(file.table_name)}`;

// GET /api/files/:id/rows?page=1&pageSize=100  Browse every row of a table, in upload order.
exports.getRows = async (req, res) => {
  try {
    const file = await getFileForWorkspace(req.params.id, req.workspaceId);
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (file.status !== 'ready') return res.status(409).json({ error: `File is ${file.status}` });
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 100));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const columns = await tableColumns(file);
    if (columns.length === 0) {
      return res.json({ columns: [], rows: [], page, pageSize, total: 0 });
    }
    const { rows } = await pool.query(
      `${selectAsText(file, columns)} ORDER BY row_id LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize]
    );
    res.json({
      columns: columns.map((c) => c.sql),
      rows,
      page,
      pageSize,
      total: Number(file.row_count) || 0,
    });
  } catch (error) {
    console.error('Get rows error:', error);
    res.status(500).json({ error: 'Failed to load rows' });
  }
};

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const DOWNLOAD_BATCH = 5000;

// GET /api/files/:id/download  The table as CSV, rebuilt from the database (uploads are not kept
// on disk on the free host). Streams in batches by row_id, so memory stays flat for big tables.
exports.downloadCsv = async (req, res) => {
  try {
    const file = await getFileForWorkspace(req.params.id, req.workspaceId);
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (file.status !== 'ready') return res.status(409).json({ error: `File is ${file.status}` });
    const columns = await tableColumns(file);
    const name = path.basename(file.original_filename).replace(/[^\w.\- ]/g, '_') || 'export.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.write(columns.map((c) => csvCell(c.header)).join(',') + '\r\n');
    if (columns.length > 0) {
      let after = 0;
      for (;;) {
        const { rows } = await pool.query(
          `${selectAsText(file, columns, 'row_id')} WHERE row_id > $1 ORDER BY row_id LIMIT $2`,
          [after, DOWNLOAD_BATCH]
        );
        if (rows.length === 0) break;
        const chunk = rows.map((r) => columns.map((c) => csvCell(r[c.sql])).join(',')).join('\r\n');
        // Respect backpressure so a slow client does not make the server buffer the whole table.
        if (!res.write(chunk + '\r\n')) await new Promise((resolve) => res.once('drain', resolve));
        after = rows[rows.length - 1].row_id;
        if (rows.length < DOWNLOAD_BATCH) break;
      }
    }
    res.end();
  } catch (error) {
    console.error('Download error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Download failed' });
    else res.end();
  }
};

// Delete file and its data
exports.deleteFile = async (req, res) => {
  const client = await pool.connect();
  try {
    const file = await getFileForWorkspace(req.params.id, req.workspaceId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    await client.query('BEGIN');
    await client.query(
      `DROP TABLE IF EXISTS ${quoteIdent(file.schema_name)}.${quoteIdent(file.table_name)}`
    );
    await client.query('DELETE FROM csv_files WHERE id = $1', [file.id]);
    await bumpDataVersion(file.ws_id, client);
    await client.query('COMMIT');

    removeUpload(path.join(UPLOAD_DIR, path.basename(file.stored_filename)));

    req.app.get('broadcast')(req.workspaceId, 'file:deleted', {
      fileId: file.id,
      filename: file.original_filename,
    });
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  } finally {
    client.release();
  }
};
