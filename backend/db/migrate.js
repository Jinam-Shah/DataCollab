// Minimal migration runner. Applies db/migrations/* in filename order, once each.
// A migration is either a .sql file or a .js/.ts module exporting `async up(client)`.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate({ connectionString = process.env.DATABASE_URL, log = console.log } = {}) {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    // Serialize concurrent runners (e.g. several API replicas starting at once).
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => /\.(sql|js|ts)$/.test(f) && !f.endsWith('.d.ts'))
      .sort();
    // tsc emits both foo.ts -> foo.js; only run each base name once.
    const seen = new Set();
    for (const file of files) {
      const base = file.replace(/\.(sql|js|ts)$/, '');
      if (seen.has(base) || applied.has(base)) continue;
      seen.add(base);

      log(`Applying migration ${base}`);
      await client.query('BEGIN');
      try {
        const full = path.join(MIGRATIONS_DIR, file);
        if (file.endsWith('.sql')) {
          await client.query(fs.readFileSync(full, 'utf8'));
        } else {
          await require(full).up(client);
        }
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [base]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${base} failed: ${err.message}`, { cause: err });
      }
    }
    // Keep the read-only role's password and settings in step with DATABASE_READER_URL.
    if (process.env.DATABASE_READER_URL && applied.size + seen.size > 0) {
      const { syncReaderRole } = require('../services/workspaceService');
      await syncReaderRole(client);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
    await pool.end();
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => console.log('Migrations complete'))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
