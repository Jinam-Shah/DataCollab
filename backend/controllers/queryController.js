const pool = require('../config/database');
const { ensureWorkspace } = require('../services/workspaceService');
const { runCachedQuery } = require('../cache/queryCache');
const { getFileForWorkspace } = require('../services/fileAccess');

// Execute SQL query through the read-only safety layer.
exports.executeQuery = async (req, res) => {
  try {
    const { query, page, pageSize } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, error: 'Query is required' });
    }

    const workspace = await ensureWorkspace(req.workspaceId);
    const result = await runCachedQuery(query, workspace, { page, pageSize });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        code: result.code,
        error: result.error,
        executionTime: result.executionTime,
      });
    }

    req.app.get('broadcast')(workspace.slug, 'query:executed', {
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
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore,
      cached: result.cached,
    });
  } catch (error) {
    console.error('Execute query error:', error);
    res.status(500).json({ success: false, error: 'Query execution failed' });
  }
};

// Get table schema (only for tables in the caller's workspace)
exports.getTableSchema = async (req, res) => {
  try {
    const workspace = await ensureWorkspace(req.workspaceId);
    const result = await pool.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [workspace.schemaName, req.params.tableName]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }
    res.json({ schema: result.rows });
  } catch (error) {
    console.error('Get schema error:', error);
    res.status(500).json({ error: 'Failed to get table schema' });
  }
};

// Get sample queries for a file
exports.getSampleQueries = async (req, res) => {
  try {
    const file = await getFileForWorkspace(req.params.fileId, req.workspaceId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    const { rows } = await pool.query(
      'SELECT column_name FROM csv_columns WHERE file_id = $1 ORDER BY column_index',
      [file.id]
    );
    const tableName = file.table_name;
    const sampleQueries = [
      { title: 'View all data', query: `SELECT * FROM "${tableName}" LIMIT 100` },
      { title: 'Count total rows', query: `SELECT COUNT(*) as total_rows FROM "${tableName}"` },
    ];
    if (rows.length > 0) {
      const firstCol = rows[0].column_name;
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
