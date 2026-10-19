// Recreate the test database from scratch and apply all migrations once per Jest run.
require('./env');
const { Client } = require('pg');

module.exports = async () => {
  const target = new URL(process.env.DATABASE_URL);
  const dbName = target.pathname.slice(1);
  const admin = new URL(target);
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  // Workspace roles are cluster-wide; remove the ones left by earlier runs of this database.
  const { rows } = await client.query('SELECT rolname FROM pg_roles WHERE rolname LIKE $1', [
    `${dbName.replace(/[^a-z0-9_]/g, '_')}_ws%_reader`,
  ]);
  for (const { rolname } of rows) await client.query(`DROP ROLE IF EXISTS "${rolname}"`);
  await client.end();

  require('tsx/cjs');
  const { migrate } = require('../../db/migrate');
  await migrate({ log: () => {} });
};
