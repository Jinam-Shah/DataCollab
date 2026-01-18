const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const CSVService = require('../services/csvService');

// Upload and process CSV file
exports.uploadCSV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, filename, size, path: filePath } = req.file;
    const userId = req.userId;

    console.log(`Processing file: ${originalname}`);

    // Step 1: Parse CSV and detect schema
    const { rows, columns, rowCount, columnCount } = await CSVService.parseCSV(filePath);

    if (rows.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    console.log(`Parsed ${rowCount} rows, ${columnCount} columns`);

    // Step 2: Save file metadata to database
    const fileQuery = `
    INSERT INTO csv_files (user_id, original_filename, stored_filename, file_size, row_count, column_count, workspace_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
    `;

    const fileResult = await pool.query(fileQuery, [
    userId,
    originalname,
    filename,
    size,
    rowCount,
    columnCount,
    req.workspaceId
    ]);
    
    const fileRecord = fileResult.rows[0];

    // Step 3: Save column metadata
    for (const col of columns) {
      await pool.query(
        `INSERT INTO csv_columns (file_id, column_name, data_type, column_index, sample_values)
         VALUES ($1, $2, $3, $4, $5)`,
        [fileRecord.id, col.name, col.type, col.index, col.samples]
      );
    }

    // Step 4: Create dynamic table for this CSV
    const tableName = await CSVService.createDataTable(fileRecord.id, columns);
    
    console.log(`Created table: ${tableName}`);

    // Step 5: Insert data into table
    await CSVService.insertData(tableName, rows, columns);
    
    console.log(`Inserted ${rows.length} rows into ${tableName}`);

    // Step 6: Get preview data
    const preview = await CSVService.getPreview(tableName, 10);

    // Broadcast to all connected clients via Socket.io
    const io = req.app.get('io');
    io.emit('file:uploaded', {
      fileId: fileRecord.id,
      filename: originalname,
      username: req.username,
      rowCount,
      columnCount
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        id: fileRecord.id,
        originalFilename: originalname,
        rowCount,
        columnCount,
        columns: columns.map(c => ({ name: c.name, type: c.type })),
        tableName,
        preview
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: 'File upload failed', details: error.message });
  }
};

// Get all uploaded files
exports.getFiles = async (req, res) => {
  try {
    const workspaceId = req.workspaceId;
    
    const query = `
      SELECT 
        f.id,
        f.original_filename,
        f.file_size,
        f.row_count,
        f.column_count,
        f.uploaded_at,
        u.username
      FROM csv_files f
      JOIN users u ON f.user_id = u.id
      WHERE f.workspace_id = $1
      ORDER BY f.uploaded_at DESC
    `;
    
    const result = await pool.query(query, [workspaceId]);
    
    res.json({ files: result.rows });
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Failed to get files' });
  }
};

// Get file details including columns
exports.getFileDetails = async (req, res) => {
  try {
    const fileId = req.params.id;
    
    // Get file info
    const fileQuery = `
      SELECT f.*, u.username
      FROM csv_files f
      JOIN users u ON f.user_id = u.id
      WHERE f.id = $1
    `;
    
    const fileResult = await pool.query(fileQuery, [fileId]);
    
    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const file = fileResult.rows[0];
    
    // Get columns
    const columnsQuery = `
      SELECT column_name, data_type, column_index, sample_values
      FROM csv_columns
      WHERE file_id = $1
      ORDER BY column_index
    `;
    
    const columnsResult = await pool.query(columnsQuery, [fileId]);
    
    // Get preview data
    const tableName = `csv_data_${fileId}`;
    const preview = await CSVService.getPreview(tableName, 10);
    
    res.json({
    file: {
    id: file.id,
    originalFilename: file.original_filename,
    fileSize: file.file_size,
    rowCount: file.row_count,
    columnCount: file.column_count,
    uploadedAt: file.uploaded_at,
    username: file.username,
    tableName,
    columns: columnsResult.rows.map(col => ({
      name: col.column_name,
      type: col.data_type
    })),
    preview: preview
  }
});
    
  } catch (error) {
    console.error('Get file details error:', error);
    res.status(500).json({ error: 'Failed to get file details' });
  }
};

// Delete file and its data
exports.deleteFile = async (req, res) => {
  try {
    const fileId = req.params.id;
    const userId = req.userId;
    
    // Check if file exists and belongs to user
    const checkQuery = `
      SELECT * FROM csv_files WHERE id = $1
    `;
    
    const checkResult = await pool.query(checkQuery, [fileId]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or unauthorized' });
    }
    
    const file = checkResult.rows[0];
    const tableName = `csv_data_${fileId}`;
    
    // Drop data table
    await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);
    
    // Delete file from filesystem
    const filePath = path.join(__dirname, '../uploads', file.stored_filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Delete from database
    await pool.query('DELETE FROM csv_files WHERE id = $1', [fileId]);
    
    console.log(`Deleted file: ${file.original_filename}`);
    
    // Broadcast deletion
    const io = req.app.get('io');
    io.emit('file:deleted', { fileId, filename: file.original_filename });
    
    res.json({ message: 'File deleted successfully' });
    
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
};