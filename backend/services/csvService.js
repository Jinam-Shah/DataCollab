const fs = require('fs');
const csv = require('csv-parser');
const pool = require('../config/database');

class CSVService {
  // Parse CSV file and detect schema
  static async parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const rows = [];
      const columns = new Map();
      let rowCount = 0;

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          rowCount++;
          
          // Detect column types from first 100 rows
          if (rowCount <= 100) {
            Object.keys(row).forEach((columnName, index) => {
              if (!columns.has(columnName)) {
                columns.set(columnName, {
                  name: columnName,
                  index: index,
                  type: 'TEXT',
                  samples: []
                });
              }
              
              const value = row[columnName];
              const col = columns.get(columnName);
              
              // Store sample values
              if (col.samples.length < 5) {
                col.samples.push(value);
              }
              
              // Detect data type
              if (value && value.trim() !== '') {
                const detectedType = this.detectDataType(value);
                if (detectedType !== 'TEXT') {
                  col.type = detectedType;
                }
              }
            });
          }
          
          rows.push(row);
        })
        .on('end', () => {
          resolve({
            rows,
            columns: Array.from(columns.values()),
            rowCount,
            columnCount: columns.size
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  // Detect data type from value
  static detectDataType(value) {
    const trimmedValue = value.trim();
    
    // Check for integer
    if (/^-?\d+$/.test(trimmedValue)) {
      return 'INTEGER';
    }
    
    // Check for float
    if (/^-?\d+\.\d+$/.test(trimmedValue)) {
      return 'FLOAT';
    }
    
    // Check for date
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue) || 
        /^\d{2}\/\d{2}\/\d{4}$/.test(trimmedValue)) {
      return 'DATE';
    }
    
    return 'TEXT';
  }

  // Create dynamic table for CSV data
  static async createDataTable(fileId, columns) {
    const tableName = `csv_data_${fileId}`;
    
    // Build CREATE TABLE statement
    const columnDefinitions = columns.map(col => {
      const sanitizedName = this.sanitizeColumnName(col.name);
      let sqlType = 'TEXT';
      
      switch (col.type) {
        case 'INTEGER':
          sqlType = 'INTEGER';
          break;
        case 'FLOAT':
          sqlType = 'NUMERIC';
          break;
        case 'DATE':
          sqlType = 'DATE';
          break;
      }
      
      return `"${sanitizedName}" ${sqlType}`;
    }).join(', ');
    
    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS "${tableName}" (
            row_id SERIAL PRIMARY KEY,
            ${columnDefinitions}
    )
`;
    
    await pool.query(createTableSQL);
    return tableName;
  }

  // Insert CSV data into table
  static async insertData(tableName, rows, columns) {
    if (rows.length === 0) return;

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Prepare column names
      const columnNames = columns.map(col => 
        `"${this.sanitizeColumnName(col.name)}"`
      ).join(', ');
      
      // Insert in batches of 500 rows
      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        
        const values = [];
        const placeholders = [];
        
        batch.forEach((row, batchIndex) => {
          const rowPlaceholders = [];
          columns.forEach((col, colIndex) => {
            const paramIndex = batchIndex * columns.length + colIndex + 1;
            rowPlaceholders.push(`$${paramIndex}`);
            
            let value = row[col.name];
            
            // Convert to appropriate type
            if (col.type === 'INTEGER' && value) {
              value = parseInt(value) || null;
            } else if (col.type === 'FLOAT' && value) {
              value = parseFloat(value) || null;
            } else if (!value || value.trim() === '') {
              value = null;
            }
            
            values.push(value);
          });
          placeholders.push(`(${rowPlaceholders.join(', ')})`);
        });
        
        const insertSQL = `
          INSERT INTO "${tableName}" (${columnNames})
          VALUES ${placeholders.join(', ')}
        `;
        
        await client.query(insertSQL, values);
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Sanitize column name for SQL
  static sanitizeColumnName(name) {
    return name
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^(\d)/, '_$1')
      .toLowerCase()
      .substring(0, 63);
  }

  // Get data preview
  static async getPreview(tableName, limit = 100) {
    const query = `SELECT * FROM "${tableName}" LIMIT $1`;
    const result = await pool.query(query, [limit]);
    return result.rows;
  }
}

module.exports = CSVService;