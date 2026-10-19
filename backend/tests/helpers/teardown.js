// Close pools after each test file so Jest can exit.
afterAll(async () => {
  const pool = require('../../config/database');
  const { closeReaderPool } = require('../../services/readonlyQuery');
  await closeReaderPool();
  await pool.end();
});
