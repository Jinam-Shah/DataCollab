// Workspaces and their PostgreSQL isolation objects.
//
// Every workspace gets:
//   - a schema `ws_<id>` that holds its uploaded tables
//   - a NOLOGIN role that can only USAGE that schema and SELECT its tables
// The read-only login role (DATABASE_READER_URL) is a NOINHERIT member of every workspace role, so
// it has no privileges of its own and must `SET LOCAL ROLE` into exactly one workspace per query.
import type { Pool, PoolClient } from 'pg';
const pool: Pool = require('../config/database');

export interface Workspace {
  id: number;
  slug: string;
  schemaName: string;
  roleName: string;
  dataVersion: number;
}

type Queryable = Pool | PoolClient;

interface WorkspaceRow {
  id: number;
  slug: string;
  schema_name: string;
  role_name: string;
  data_version: number;
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    slug: row.slug,
    schemaName: row.schema_name,
    roleName: row.role_name,
    dataVersion: row.data_version,
  };
}

export function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

export function readerLoginRole(): string {
  const url = process.env.DATABASE_READER_URL;
  if (!url) return 'datacollab_reader';
  return decodeURIComponent(new URL(url).username) || 'datacollab_reader';
}

/**
 * Create or update the read-only login role from DATABASE_READER_URL: NOINHERIT (no privileges
 * of its own), 5 s statement timeout, read-only transactions by default. Runs on every migrate,
 * so changing the password in the environment and re-running `npm run migrate` rotates it.
 */
export async function syncReaderRole(db: Queryable): Promise<void> {
  const url = process.env.DATABASE_READER_URL;
  if (!url) {
    throw new Error(
      'DATABASE_READER_URL is not set. It is the login for the read-only query role, e.g. ' +
        'postgresql://datacollab_reader:<password>@localhost:5432/datacollab'
    );
  }
  const role = readerLoginRole();
  const password = decodeURIComponent(new URL(url).password);
  const exists = await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  const verb = exists.rowCount ? 'ALTER' : 'CREATE';
  const { rows } = await db.query<{ sql: string }>(
    `SELECT format('${verb} ROLE %I WITH LOGIN NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) AS sql`,
    [role, password]
  );
  await db.query(rows[0].sql);

  const r = quoteIdent(role);
  await db.query(`ALTER ROLE ${r} SET statement_timeout = '5s'`);
  await db.query(`ALTER ROLE ${r} SET default_transaction_read_only = on`);
  await db.query(`ALTER ROLE ${r} SET idle_in_transaction_session_timeout = '10s'`);
  await db.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`);
}

/** Create the schema, role and grants for a workspace. Idempotent. */
export async function provisionWorkspace(db: Queryable, ws: Workspace): Promise<void> {
  const schema = quoteIdent(ws.schemaName);
  const role = quoteIdent(ws.roleName);
  const reader = quoteIdent(readerLoginRole());

  await db.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  const exists = await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ws.roleName]);
  if (exists.rowCount === 0) {
    try {
      await db.query(`CREATE ROLE ${role} NOLOGIN`);
    } catch (err) {
      // Another process created it between the check and the CREATE.
      if ((err as { code?: string }).code !== '42710') throw err;
    }
  }
  await db.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`);
  await db.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${role}`);
  await db.query(`GRANT ${role} TO ${reader}`);
}

/** Return the workspace for `slug`, creating and provisioning it on first use. */
export async function ensureWorkspace(slug: string, db?: Queryable): Promise<Workspace> {
  const existing = await (db ?? pool).query<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE slug = $1',
    [slug]
  );
  if (existing.rows[0]) return toWorkspace(existing.rows[0]);

  // Caller-supplied clients (migrations) are already inside a transaction.
  if (db) return createWorkspace(db, slug);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ws = await createWorkspace(client, slug);
    await client.query('COMMIT');
    return ws;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function createWorkspace(db: Queryable, slug: string): Promise<Workspace> {
  // Serialize creation per slug so concurrent first requests do not race on the schema and role.
  await db.query("SELECT pg_advisory_xact_lock(hashtext('workspace:' || $1))", [slug]);
  const again = await db.query<WorkspaceRow>('SELECT * FROM workspaces WHERE slug = $1', [slug]);
  if (again.rows[0]) return toWorkspace(again.rows[0]);

  // Role names are global to the PostgreSQL cluster, so include the database name to keep
  // several databases (dev, test) on one server from colliding.
  const inserted = await db.query<WorkspaceRow>(
    `INSERT INTO workspaces (id, slug, schema_name, role_name)
     SELECT n, $1, 'ws_' || n,
            left(regexp_replace(lower(current_database()), '[^a-z0-9_]', '_', 'g'), 30)
              || '_ws' || n || '_reader'
       FROM (SELECT nextval(pg_get_serial_sequence('workspaces', 'id')) AS n) seq
     RETURNING *`,
    [slug]
  );
  const ws = toWorkspace(inserted.rows[0]);
  await provisionWorkspace(db, ws);
  return ws;
}

export async function getWorkspace(slug: string): Promise<Workspace | null> {
  const result = await pool.query<WorkspaceRow>('SELECT * FROM workspaces WHERE slug = $1', [slug]);
  return result.rows[0] ? toWorkspace(result.rows[0]) : null;
}

/** Called after every change to a workspace's data, so caches keyed on the version go stale. */
export async function bumpDataVersion(workspaceId: number, db: Queryable = pool): Promise<number> {
  const result = await db.query<{ data_version: number }>(
    'UPDATE workspaces SET data_version = data_version + 1 WHERE id = $1 RETURNING data_version',
    [workspaceId]
  );
  return result.rows[0]?.data_version ?? 0;
}
