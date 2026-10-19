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
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
            maxOutputTokens: 500,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
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
      throw new Error('Failed to generate SQL query');
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

  static extractSQL(text) {
    text = text.trim();

    text = text.replace(/```sql\n?/gi, '');
    text = text.replace(/```\n?/g, '');

    text = text.split('\n')[0].trim();

    if (!text.toUpperCase().startsWith('SELECT')) {
      const selectMatch = text.match(/SELECT[\s\S]*/i);
      if (selectMatch) {
        text = selectMatch[0];
      }
    }

    text = text.replace(/;$/, '');

    return text.trim();
  }
}

module.exports = GeminiService;
