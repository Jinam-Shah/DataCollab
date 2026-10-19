// Start the API for Playwright: fresh database, migrations, fake LLM. Used by
// frontend/playwright.config.mjs; not for production.
const { Client } = require('pg');
const path = require('path');

const base =
  process.env.E2E_DATABASE_URL ||
  'postgresql://datacollab:datacollab@localhost:5432/datacollab_e2e';
const db = new URL(base);
const reader = new URL(base);
reader.username = 'datacollab_e2e_reader';
reader.password = 'e2e_reader_pw';

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: process.env.E2E_API_PORT || '5055',
  DATABASE_URL: db.toString(),
  DATABASE_READER_URL: reader.toString(),
  JWT_SECRET: 'e2e-secret',
  FRONTEND_URL: process.env.E2E_FRONTEND_URL || 'http://localhost:3055',
  LLM_PROVIDER: 'fake',
  FAKE_LLM_SCRIPT: path.join(__dirname, '..', '..', 'frontend', 'e2e', 'fake-llm.json'),
  REDIS_URL: '',
  UPLOAD_DIR: path.join(require('os').tmpdir(), 'datacollab-e2e-uploads'),
});

async function main() {
  const name = db.pathname.slice(1);
  const admin = new URL(db);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"`);
  const { rows } = await client.query('SELECT rolname FROM pg_roles WHERE rolname LIKE $1', [
    `${name}_ws%_reader`,
  ]);
  for (const { rolname } of rows) await client.query(`DROP ROLE IF EXISTS "${rolname}"`);
  await client.end();

  await require('../db/migrate').migrate({ log: () => {} });
  require('../server');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
