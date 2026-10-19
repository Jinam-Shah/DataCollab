const pool = require('../config/database');
const { quoteIdent } = require('./workspaceService');

const INT_RE = /^[-+]?\d+$/;
const FLOAT_RE = /^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
// ISO 8601 date-time, e.g. 2024-01-01T00:37:09.096Z or 2024-01-01 08:00:00+02:00
const ISO_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/;

// Type ranks: a column takes the narrowest type that fits every non-empty value.
const NUMERIC_TYPES = ['INTEGER', 'FLOAT'];
const TIME_TYPES = ['DATE', 'TIMESTAMP'];

function isValidDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

class CSVService {
  // Detect the type of a single value: INTEGER, FLOAT, DATE, TIMESTAMP or TEXT.
  static detectDataType(value) {
    const v = value.trim();
    if (INT_RE.test(v)) return 'INTEGER';
    if (FLOAT_RE.test(v)) return 'FLOAT';
    let m = v.match(ISO_DATE_RE);
    if (m && isValidDate(+m[1], +m[2], +m[3])) return 'DATE';
    m = v.match(US_DATE_RE);
    if (m && isValidDate(+m[3], +m[1], +m[2])) return 'DATE';
    m = v.match(ISO_TIMESTAMP_RE);
    if (m && isValidDate(+m[1], +m[2], +m[3]) && !Number.isNaN(Date.parse(v))) return 'TIMESTAMP';
    return 'TEXT';
  }

  // Combine two value types into the narrowest column type that holds both.
  static widenType(current, next) {
    if (!current) return next;
    if (current === next) return current;
    if (NUMERIC_TYPES.includes(current) && NUMERIC_TYPES.includes(next)) return 'FLOAT';
    if (TIME_TYPES.includes(current) && TIME_TYPES.includes(next)) return 'TIMESTAMP';
    return 'TEXT';
  }

  static sqlType(col) {
    switch (col.type) {
      case 'INTEGER':
        return col.big ? 'NUMERIC' : 'INTEGER';
      case 'FLOAT':
        return 'DOUBLE PRECISION';
      case 'DATE':
        return 'DATE';
      case 'TIMESTAMP':
        return 'TIMESTAMPTZ';
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
