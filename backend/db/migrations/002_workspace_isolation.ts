// Phase 1: per-workspace schemas and the read-only query role.
//
// - adds a `workspaces` table (one row per workspace string users registered with)
// - creates the read-only login role from DATABASE_READER_URL with a 5 s statement timeout
// - creates a schema and a SELECT-only role per workspace
// - moves every existing public.csv_data_<id> table into its workspace schema
// - adds workspace_id to chat_messages so chat history can be scoped without joining users
import type { PoolClient } from 'pg';
import {
  ensureWorkspace,
  provisionWorkspace,
  quoteIdent,
  readerLoginRole,
  type Workspace,
} from '../../services/workspaceService';

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(50) UNIQUE NOT NULL,
      schema_name TEXT UNIQUE NOT NULL,
      role_name TEXT UNIQUE NOT NULL,
      data_version INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query('ALTER TABLE csv_files ADD COLUMN IF NOT EXISTS table_name TEXT');
  await client.query('ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(50)');
  await client.query(`
    UPDATE chat_messages cm SET workspace_id = u.workspace_id
      FROM users u WHERE u.id = cm.user_id AND cm.workspace_id IS NULL
  `);
  await client.query(
    'CREATE INDEX IF NOT EXISTS idx_chat_messages_workspace ON chat_messages(workspace_id, sent_at DESC)'
  );

  await createReaderRole(client);

  const slugs = await client.query<{ slug: string }>(`
    SELECT workspace_id AS slug FROM users WHERE workspace_id IS NOT NULL
    UNION
    SELECT workspace_id FROM csv_files WHERE workspace_id IS NOT NULL
  `);
  const bySlug = new Map<string, Workspace>();
  for (const { slug } of slugs.rows) {
    bySlug.set(slug, await ensureWorkspace(slug, client));
  }

  const files = await client.query<{ id: number; workspace_id: string | null }>(
    'SELECT id, workspace_id FROM csv_files'
  );
  for (const file of files.rows) {
    const slug = file.workspace_id ?? 'default';
    if (!bySlug.has(slug)) bySlug.set(slug, await ensureWorkspace(slug, client));
    const ws = bySlug.get(slug) as Workspace;
    const table = `csv_data_${file.id}`;
    await client.query(
      `ALTER TABLE IF EXISTS public.${quoteIdent(table)} SET SCHEMA ${quoteIdent(ws.schemaName)}`
    );
    await client.query('UPDATE csv_files SET table_name = $1, workspace_id = $2 WHERE id = $3', [
      table,
      ws.slug,
      file.id,
    ]);
  }
  // Default privileges do not cover tables moved in, so grant again.
  for (const ws of bySlug.values()) await provisionWorkspace(client, ws);

  await client.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_csv_files_ws_table ON csv_files(workspace_id, table_name)'
  );
}

async function createReaderRole(client: PoolClient): Promise<void> {
  const url = process.env.DATABASE_READER_URL;
  if (!url) {
    throw new Error(
      'DATABASE_READER_URL is not set. It is the login for the read-only query role, e.g. ' +
        'postgresql://datacollab_reader:<password>@localhost:5432/datacollab'
    );
  }
  const role = readerLoginRole();
  const password = decodeURIComponent(new URL(url).password);
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  const verb = exists.rowCount ? 'ALTER' : 'CREATE';
  const { rows } = await client.query<{ sql: string }>(
    `SELECT format('${verb} ROLE %I WITH LOGIN NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) AS sql`,
    [role, password]
  );
  await client.query(rows[0].sql);

  const r = quoteIdent(role);
  await client.query(`ALTER ROLE ${r} SET statement_timeout = '5s'`);
  await client.query(`ALTER ROLE ${r} SET default_transaction_read_only = on`);
  await client.query(`ALTER ROLE ${r} SET idle_in_transaction_session_timeout = '10s'`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`);
}
