const GeminiService = require('../services/geminiService');
const pool = require('../config/database');
const { getFileForWorkspace } = require('../services/fileAccess');

// Single-shot NL-to-SQL for one file (kept as the baseline next to the agent).
exports.textToSQL = async (req, res) => {
  try {
    const { question, fileId } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }
    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }

    const file = await getFileForWorkspace(fileId, req.workspaceId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const schemaResult = await pool.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name <> 'row_id'
        ORDER BY ordinal_position`,
      [file.schema_name, file.table_name]
    );
    if (schemaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Table schema not found' });
    }

    const result = await GeminiService.generateSQL(question, {
      tableName: file.table_name,
      columns: schemaResult.rows,
    });

    res.json({ success: true, query: result.query, question });
  } catch (error) {
    console.error('Text-to-SQL error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate SQL query' });
  }
};
