// Create the demo account and load the public demo dataset into its workspace. Idempotent.
//   npm run seed:demo
// DEMO_EMAIL / DEMO_PASSWORD / DEMO_WORKSPACE override the defaults.
import fs from 'fs';
import path from 'path';
require('dotenv').config();
import { ensureWorkspace } from '../services/workspaceService';
import { ingestFile } from '../ingest/ingestFile';
const pool = require('../config/database');
const User = require('../models/User');
const { UPLOAD_DIR } = require('../config/paths');

export const DEMO_TABLES = ['earthquakes', 'causes_of_death', 'state_population'];
const DATA_DIR = path.join(__dirname, '..', 'eval', 'data');

export async function seedDemo(opts: { log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const email = process.env.DEMO_EMAIL || 'demo@datacollab.dev';
  const password = process.env.DEMO_PASSWORD || 'demo1234';
  const slug = process.env.DEMO_WORKSPACE || 'demo';

  const workspace = await ensureWorkspace(slug);
  let user = await User.findByEmail(email);
  if (!user) {
    user = await User.create('demo', email, password, slug);
    log(`Created demo user ${email}`);
  }

  for (const table of DEMO_TABLES) {
    const existing = await pool.query(
      "SELECT id FROM csv_files WHERE workspace_id = $1 AND table_name = $2 AND status = 'ready'",
      [slug, table]
    );
    if (existing.rows[0]) {
      log(`${table}: already loaded`);
      continue;
    }
    await pool.query('DELETE FROM csv_files WHERE workspace_id = $1 AND table_name = $2', [slug, table]);
    const source = path.join(DATA_DIR, `${table}.csv`);
    const stored = `demo-${table}-${Date.now()}.csv`;
    fs.copyFileSync(source, path.join(UPLOAD_DIR, stored));
    const { rows } = await pool.query(
      `INSERT INTO csv_files (user_id, original_filename, stored_filename, file_size, workspace_id, table_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued') RETURNING id`,
      [user.id, `${table}.csv`, stored, fs.statSync(source).size, slug, table]
    );
    const result = await ingestFile({ fileId: rows[0].id, workspaceSlug: slug, filePath: path.join(UPLOAD_DIR, stored) });
    log(`${table}: loaded ${result.rowCount} rows in ${result.ingestMs} ms`);
  }
  return { workspace, email, password };
}

if (require.main === module) {
  seedDemo()
    .then(({ email }) => {
      console.log(`Demo workspace ready. Log in as ${email}`);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
