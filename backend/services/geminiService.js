const axios = require('axios');

class GeminiService {
  static async generateSQL(naturalLanguageQuery, tableSchema) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey === 'PLACEHOLDER_WILL_ADD_LATER') {
      throw new Error('Gemini API key not configured');
    }

    const prompt = this.buildPrompt(naturalLanguageQuery, tableSchema);

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-3.8-flash'}:generateContent`,
        {
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        },
        {
          // The key goes in a header, not the URL, so it never appears in proxy or request logs.
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
        }
      );

      const generatedText = response.data.candidates[0].content.parts[0].text;

      const sqlQuery = this.extractSQL(generatedText);

      return {
        success: true,
        query: sqlQuery,
        originalResponse: generatedText,
      };
    } catch (error) {
      console.error('Gemini API error:', error.response?.data || error.message);
      throw new Error('Failed to generate SQL query', { cause: error });
    }
  }

  static buildPrompt(naturalLanguageQuery, tableSchema) {
    const { tableName, columns } = tableSchema;

    const columnList = columns.map((col) => `  - ${col.column_name} (${col.data_type})`).join('\n');

    return `You are a SQL query generator. Convert the natural language question into a valid PostgreSQL SELECT query.

TABLE INFORMATION:
Table name: "${tableName}"
Columns:
${columnList}

RULES:
1. Only generate SELECT queries
2. Use double quotes for table and column names
3. Return ONLY the SQL query, no explanation
4. Do not use markdown code blocks
5. Ensure the query is valid PostgreSQL syntax

QUESTION: ${naturalLanguageQuery}

SQL QUERY:`;
  }

  // Pull the SQL out of the model's reply. Keeps multi-line queries (the original code kept
  // only the first line, which truncated anything Gemini formatted over several lines).
  static extractSQL(text) {
    let sql = String(text)
      .replace(/```(?:sql)?/gi, '')
      .trim();
    const start = sql.search(/\b(with|select)\b/i);
    if (start > 0) sql = sql.slice(start);
    return sql.replace(/;\s*$/, '').trim();
  }
}

module.exports = GeminiService;
