const SQLService = require('../services/sqlService');
const pool = require('../config/database');

// Execute SQL query
exports.executeQuery = async (req, res) => {
  try {
    const { query, fileId } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`Executing query: ${query.substring(0, 100)}...`);

    // Execute the query
    const result = await SQLService.executeQuery(query);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        executionTime: result.executionTime,
      });
    }

    // Broadcast query execution to all connected clients
    const io = req.app.get('io');
    io.emit('query:executed', {
      username: req.username,
      query: query.substring(0, 100),
      rowCount: result.rowCount,
      executionTime: result.executionTime,
    });

    res.json({
      success: true,
      data: result.rows,
      rowCount: result.rowCount,
      executionTime: result.executionTime,
      columns: result.columns,
    });
  } catch (error) {
    console.error('Execute query error:', error);
    res.status(500).json({
      success: false,
      error: 'Query execution failed',
      details: error.message,
    });
  }
};

// Get table schema
exports.getTableSchema = async (req, res) => {
  try {
    const { tableName } = req.params;

    // Verify table exists
    const checkQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = $1
      )
    `;

    const checkResult = await pool.query(checkQuery, [tableName]);

    if (!checkResult.rows[0].exists) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const schema = await SQLService.getTableSchema(tableName);

    res.json({ schema });
  } catch (error) {
    console.error('Get schema error:', error);
    res.status(500).json({ error: 'Failed to get table schema' });
  }
};

// Get sample queries for a file
exports.getSampleQueries = async (req, res) => {
  try {
    const { fileId } = req.params;

    // Get file details
    const fileQuery = `
      SELECT f.*, 
        (SELECT array_agg(column_name ORDER BY column_index) 
         FROM csv_columns 
         WHERE file_id = f.id) as columns
      FROM csv_files f
      WHERE f.id = $1
    `;

    const fileResult = await pool.query(fileQuery, [fileId]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = fileResult.rows[0];
    const tableName = `csv_data_${fileId}`;
    const columns = file.columns || [];

    // Generate sample queries
    const sampleQueries = [
      {
        title: 'View all data',
        query: `SELECT * FROM "${tableName}" LIMIT 100`,
      },
      {
        title: 'Count total rows',
        query: `SELECT COUNT(*) as total_rows FROM "${tableName}"`,
      },
    ];

    // Add column-specific queries if columns exist
    if (columns.length > 0) {
      const firstCol = columns[0];
      sampleQueries.push({
        title: `Group by ${firstCol}`,
        query: `SELECT "${firstCol}", COUNT(*) as count FROM "${tableName}" GROUP BY "${firstCol}" ORDER BY count DESC LIMIT 10`,
      });
    }

    res.json({ sampleQueries });
  } catch (error) {
    console.error('Get sample queries error:', error);
    res.status(500).json({ error: 'Failed to generate sample queries' });
  }
};
