const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

console.log('Testing database connection...');

pool.query('SELECT NOW(), current_database()', (err, res) => {
  if (err) {
    console.error('Database Error:', err.message);
    process.exit(1);
  } else {
    console.log('Database Connected Successfully!');
    console.log('Current time:', res.rows[0].now);
    console.log('Database name:', res.rows[0].current_database);
  }
  pool.end();
});