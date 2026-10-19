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
