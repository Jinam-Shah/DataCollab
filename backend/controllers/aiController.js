const GeminiService = require('../services/geminiService');
const pool = require('../config/database');

exports.textToSQL = async (req, res) => {
  try {
    const { question, fileId } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }

    const tableName = `csv_data_${fileId}`;

    const schemaQuery = `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `;

    const schemaResult = await pool.query(schemaQuery, [tableName]);

    if (schemaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Table schema not found' });
    }

    const tableSchema = {
      tableName: tableName,
      columns: schemaResult.rows,
    };

    console.log(`Generating SQL for: "${question}"`);

    const result = await GeminiService.generateSQL(question, tableSchema);

    res.json({
      success: true,
      query: result.query,
      question: question,
    });
  } catch (error) {
    console.error('Text-to-SQL error:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate SQL query',
    });
  }
};
