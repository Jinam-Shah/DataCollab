const { Pool, types } = require('pg');
require('dotenv').config();

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates shifted to local midnight.
types.setTypeParser(1082, (value) => value);

// Application pool. It owns the app tables and workspace schemas, so it must never run
// user-written SQL. That goes through services/readonlyQuery.ts on the reader pool.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

module.exports = pool;
