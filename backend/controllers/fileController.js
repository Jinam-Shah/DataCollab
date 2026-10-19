const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const CSVService = require('../services/csvService');
const { ensureWorkspace, bumpDataVersion, quoteIdent } = require('../services/workspaceService');
const { getFileForWorkspace } = require('../services/fileAccess');

function removeUpload(filePath) {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// Upload and process CSV file
exports.uploadCSV = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const { originalname, filename, size, path: filePath } = req.file;

  const client = await pool.connect();
  try {
    const workspace = await ensureWorkspace(req.workspaceId);
    const { rows, columns, rowCount, columnCount } = await CSVService.parseCSV(filePath);

    if (rows.length === 0) {
      removeUpload(filePath);
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    // Metadata, table and rows are written in one transaction, so a failed upload leaves nothing behind.
    await client.query('BEGIN');
    const tableName = await CSVService.uniqueTableName(workspace.slug, originalname, client);
    const fileResult = await client.query(
      `INSERT INTO csv_files (user_id, original_filename, stored_filename, file_size, row_count,
                              column_count, workspace_id, table_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.userId, originalname, filename, size, rowCount, columnCount, workspace.slug, tableName]
    );
    const fileRecord = fileResult.rows[0];

    for (const col of columns) {
      await client.query(
        `INSERT INTO csv_columns (file_id, column_name, data_type, column_index, sample_values)
         VALUES ($1, $2, $3, $4, $5)`,
        [fileRecord.id, col.sqlName, col.type, col.index, col.samples]
      );
    }

    await CSVService.createDataTable(workspace.schemaName, tableName, columns, client);
    await CSVService.insertData(workspace.schemaName, tableName, rows, columns, client);
    await bumpDataVersion(workspace.id, client);
    await client.query('COMMIT');

    const preview = await CSVService.getPreview(workspace.schemaName, tableName, 10);

    req.app.get('broadcast')(workspace.slug, 'file:uploaded', {
      fileId: fileRecord.id,
      filename: originalname,
      username: req.username,
      rowCount,
      columnCount,
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        id: fileRecord.id,
        originalFilename: originalname,
        rowCount,
        columnCount,
        columns: columns.map((c) => ({ name: c.sqlName, type: c.type })),
        tableName,
        preview,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Upload error:', error);
    removeUpload(filePath);
    res.status(500).json({ error: 'File upload failed', details: error.message });
  } finally {
    client.release();
  }
};

// Get all uploaded files
exports.getFiles = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.original_filename, f.file_size, f.row_count, f.column_count,
              f.uploaded_at, f.table_name, u.username
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
    const preview = await CSVService.getPreview(file.schema_name, file.table_name, 10);

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

    removeUpload(path.join(__dirname, '../uploads', path.basename(file.stored_filename)));

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
