const fs = require('fs');
const csv = require('csv-parser');
const pool = require('../config/database');
const { quoteIdent } = require('./workspaceService');

const INT_RE = /^[-+]?\d+$/;
const FLOAT_RE = /^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const INT32_MAX = 2147483647;

// Type ranks: a column takes the narrowest type that fits every non-empty value.
const NUMERIC_TYPES = ['INTEGER', 'FLOAT'];

function isValidDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

class CSVService {
  // Parse CSV file and detect schema
  static async parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const rows = [];
      let headers = null;

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('headers', (h) => {
          headers = h;
        })
        .on('data', (row) => rows.push(row))
        .on('end', () => {
          const columns = this.inferColumns(headers || [], rows);
          resolve({ rows, columns, rowCount: rows.length, columnCount: columns.length });
        })
        .on('error', reject);
    });
  }

  // Detect the type of a single value: INTEGER, FLOAT, DATE or TEXT.
  static detectDataType(value) {
    const v = value.trim();
    if (INT_RE.test(v)) return 'INTEGER';
    if (FLOAT_RE.test(v)) return 'FLOAT';
    let m = v.match(ISO_DATE_RE);
    if (m && isValidDate(+m[1], +m[2], +m[3])) return 'DATE';
    m = v.match(US_DATE_RE);
    if (m && isValidDate(+m[3], +m[1], +m[2])) return 'DATE';
    return 'TEXT';
  }

  // Combine two value types into the narrowest column type that holds both.
  static widenType(current, next) {
    if (!current) return next;
    if (current === next) return current;
    if (NUMERIC_TYPES.includes(current) && NUMERIC_TYPES.includes(next)) return 'FLOAT';
    return 'TEXT';
  }

  // Build column metadata from every row (not only the first 100), with unique SQL names.
  static inferColumns(headers, rows) {
    const used = new Set(['row_id']);
    return headers.map((name, index) => {
      let type = null;
      let maxAbsInt = 0;
      const samples = [];
      for (const row of rows) {
        const value = row[name];
        if (samples.length < 5 && value !== undefined) samples.push(value);
        if (value === undefined || value === null || value.trim() === '') continue;
        const t = this.detectDataType(value);
        type = this.widenType(type, t);
        if (t === 'INTEGER') maxAbsInt = Math.max(maxAbsInt, Math.abs(Number(value)));
        if (type === 'TEXT') break;
      }
      // Collect the remaining samples if the loop stopped early.
      for (let i = samples.length; i < Math.min(5, rows.length); i++) samples.push(rows[i][name]);

      let sqlName = this.sanitizeColumnName(name) || `column_${index + 1}`;
      const base = sqlName;
      for (let n = 2; used.has(sqlName); n++) sqlName = `${base.substring(0, 58)}_${n}`;
      used.add(sqlName);

      return {
        name,
        sqlName,
        index,
        type: type || 'TEXT',
        big: type === 'INTEGER' && maxAbsInt > INT32_MAX,
        samples,
      };
    });
  }

  static sqlType(col) {
    switch (col.type) {
      case 'INTEGER':
        return col.big ? 'NUMERIC' : 'INTEGER';
      case 'FLOAT':
        return 'DOUBLE PRECISION';
      case 'DATE':
        return 'DATE';
      default:
        return 'TEXT';
    }
  }

  // Convert one raw CSV value for insertion into a column of the inferred type.
  static convertValue(raw, col) {
    if (raw === undefined || raw === null) return null;
    const v = String(raw).trim();
    if (v === '') return null;
    switch (col.type) {
      case 'INTEGER':
        return col.big ? v : parseInt(v, 10);
      case 'FLOAT':
        return parseFloat(v);
      case 'DATE': {
        const us = v.match(US_DATE_RE);
        if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
        return v;
      }
      default:
        return raw;
    }
  }

  // Create the table for a CSV inside its workspace schema.
  static async createDataTable(schemaName, tableName, columns, db = pool) {
    const columnDefinitions = columns
      .map((col) => `${quoteIdent(col.sqlName)} ${this.sqlType(col)}`)
      .join(', ');
    await db.query(
      `CREATE TABLE ${quoteIdent(schemaName)}.${quoteIdent(tableName)} (
         row_id SERIAL PRIMARY KEY${columnDefinitions ? ', ' + columnDefinitions : ''}
       )`
    );
    return tableName;
  }

  // Insert rows in batches. Pass a client to run inside the caller's transaction.
  static async insertData(schemaName, tableName, rows, columns, db = null, batchSize = 500) {
    if (rows.length === 0 || columns.length === 0) return;
    const client = db || (await pool.connect());
    const ownTransaction = !db;
    const target = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;
    const columnNames = columns.map((c) => quoteIdent(c.sqlName)).join(', ');
    // PostgreSQL allows at most 65535 bind parameters per statement.
    const size = Math.max(1, Math.min(batchSize, Math.floor(65535 / columns.length)));

    try {
      if (ownTransaction) await client.query('BEGIN');
      for (let i = 0; i < rows.length; i += size) {
        const batch = rows.slice(i, i + size);
        const values = [];
        const placeholders = batch.map((row, b) => {
          const ph = columns.map((col, c) => {
            values.push(this.convertValue(row[col.name], col));
            return `$${b * columns.length + c + 1}`;
          });
          return `(${ph.join(', ')})`;
        });
        await client.query(
          `INSERT INTO ${target} (${columnNames}) VALUES ${placeholders.join(', ')}`,
          values
        );
      }
      if (ownTransaction) await client.query('COMMIT');
    } catch (error) {
      if (ownTransaction) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (ownTransaction) client.release();
    }
  }

  // Sanitize column name for SQL
  static sanitizeColumnName(name) {
    return String(name)
      .replace(/^\uFEFF/, '')
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^(\d)/, '_$1')
      .toLowerCase()
      .substring(0, 63);
  }

  // Pick a readable table name from the file name, unique within the workspace.
  static async uniqueTableName(workspaceSlug, originalFilename, db = pool) {
    let base = this.sanitizeColumnName(String(originalFilename).replace(/\.csv$/i, ''))
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 50);
    if (!base || base.startsWith('pg_')) base = `table_${base}`.replace(/_+$/, '');
    const { rows } = await db.query(
      'SELECT table_name FROM csv_files WHERE workspace_id = $1 AND table_name LIKE $2',
      [workspaceSlug, `${base}%`]
    );
    const taken = new Set(rows.map((r) => r.table_name));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
    return name;
  }

  // Get data preview
  static async getPreview(schemaName, tableName, limit = 100) {
    const result = await pool.query(
      `SELECT * FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)} ORDER BY row_id LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
}

module.exports = CSVService;
