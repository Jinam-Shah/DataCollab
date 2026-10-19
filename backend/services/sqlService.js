const pool = require('../config/database');

class SQLService {
  // Execute SQL query with safety checks
  static async executeQuery(query, tableName) {
    // Validate query is safe
    const validation = this.validateQuery(query);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const startTime = Date.now();

    try {
      const result = await pool.query(query);
      const executionTime = Date.now() - startTime;

      return {
        success: true,
        rows: result.rows,
        rowCount: result.rowCount,
        executionTime,
        columns: result.fields ? result.fields.map((f) => f.name) : [],
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      return {
        success: false,
        error: this.formatError(error),
        executionTime,
      };
    }
  }

  // Validate SQL query for safety
  static validateQuery(query) {
    const normalizedQuery = query.toLowerCase().trim();

    // Block dangerous operations
    const dangerousKeywords = [
      'drop table',
      'drop database',
      'truncate',
      'delete from users',
      'delete from csv_files',
      'delete from csv_columns',
      'delete from chat_messages',
      'update users',
      'update csv_files',
      'insert into users',
      'insert into csv_files',
      'alter table',
      'create table',
      'create database',
      'grant',
      'revoke',
    ];

    for (const keyword of dangerousKeywords) {
      if (normalizedQuery.includes(keyword)) {
        return {
          isValid: false,
          error: `Query contains dangerous operation: ${keyword}`,
        };
      }
    }

    // Must be a SELECT query for now
    if (!normalizedQuery.startsWith('select')) {
      return {
        isValid: false,
        error: 'Only SELECT queries are allowed',
      };
    }

    return { isValid: true };
  }

  // Format SQL error for user-friendly display
  static formatError(error) {
    const message = error.message;

    // Common SQL errors
    if (message.includes('syntax error')) {
      return 'SQL Syntax Error: Check your query syntax';
    }

    if (message.includes('column') && message.includes('does not exist')) {
      const match = message.match(/column "([^"]+)"/);
      const column = match ? match[1] : 'unknown';
      return `Column "${column}" does not exist in the table`;
    }

    if (message.includes('relation') && message.includes('does not exist')) {
      const match = message.match(/relation "([^"]+)"/);
      const table = match ? match[1] : 'unknown';
      return `Table "${table}" does not exist`;
    }

    if (message.includes('division by zero')) {
      return 'Division by zero error';
    }

    if (message.includes('invalid input syntax')) {
      return 'Invalid data type in query';
    }

    // Return original error if we can't format it
    return message;
  }

  // Get table schema information
  static async getTableSchema(tableName) {
    const query = `
      SELECT 
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `;

    const result = await pool.query(query, [tableName]);
    return result.rows;
  }

  // Execute query with pagination
  static async executeQueryWithPagination(query, page = 1, pageSize = 100) {
    const offset = (page - 1) * pageSize;
    const paginatedQuery = `${query} LIMIT ${pageSize} OFFSET ${offset}`;

    return await this.executeQuery(paginatedQuery);
  }
}

module.exports = SQLService;
