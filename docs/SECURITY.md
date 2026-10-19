# Security: running SQL written by users and by the AI agent

DataCollab runs SQL that users type and SQL that an LLM writes on its own. Both are treated as
untrusted. This document lists each control, what it prevents, and what it does not.

## Threat model

| Actor | Goal |
|---|---|
| Logged-in user | Read or change another workspace's data; read password hashes; change or destroy data; slow the database down for everyone |
| Prompt-injected or confused agent | Same as above, triggered by text inside an uploaded CSV, a document, or a crafted question |
| Anonymous visitor | Use the API or the WebSocket without logging in |

Out of scope: a compromised server or database host, stolen JWT secrets, and denial of service at the network level.

## Controls

The path for every query (`POST /api/queries/execute`, the agent's `run_readonly_query` tool, and the MCP server) is
`security/sqlGuard.ts` → `services/readonlyQuery.ts`.

### 1. Per-workspace schemas

Each workspace's uploaded tables live in their own schema, `ws_<id>`, instead of next to the
application tables in `public`. Migration `002_workspace_isolation` moved the existing `csv_data_<id>` tables.

- **Prevents:** a query in one workspace naming another workspace's tables by guessing `csv_data_<n>`.
  The search path only contains the caller's schema.
- **Does not prevent, on its own:** a schema-qualified name like `ws_2.t`. That is handled by 2 and 4.

### 2. Read-only roles

- `datacollab_reader` is a separate login (`DATABASE_READER_URL`) with `NOINHERIT`, so it has no table privileges of its own.
- Each workspace has a `NOLOGIN` role with `USAGE` on its schema and `SELECT` on its tables, and nothing else.
- Every query runs in `BEGIN READ ONLY` followed by `SET LOCAL ROLE <workspace role>` and `SET LOCAL search_path TO ws_<id>`.
- The login role has `statement_timeout = 5s`, `default_transaction_read_only = on` and
  `idle_in_transaction_session_timeout = 10s` set with `ALTER ROLE`. The executor also sets
  `statement_timeout` per transaction (`QUERY_TIMEOUT_MS`, default 5000).

- **Prevents:** reading `users`, `chat_messages`, `csv_files` or any other application table;
  reading other workspaces' schemas; any write (INSERT, UPDATE, DELETE, DDL, `nextval`, `SELECT FOR UPDATE`), even if the parser
  were bypassed. This is checked in `tests/security.test.js` by talking to the reader pool directly.
- **Does not prevent:** reading object *names* from `pg_catalog` through functions (for example
  `to_regclass('ws_2.t')`). The parser blocks direct `pg_*` and `information_schema` relations, but table and
  column names of other workspaces are metadata visible to every role in PostgreSQL.

### 3. Separate connection pool

User and agent SQL never touches the application pool (`config/database.js`), which owns the
tables. It uses its own small pool (`READER_POOL_MAX`, default 5).

- **Prevents:** escalation through the app role's privileges, and user queries using up the app's connections.
- **Does not prevent:** five slow queries at once filling the reader pool for up to 5 seconds. Rate limits (Phase 9) reduce this.

### 4. Single-statement parser check (`security/sqlGuard.ts`)

The SQL is parsed with `libpg-query`, which is PostgreSQL's own parser compiled to WebAssembly,
so it reads SQL the same way the server does. It rejects:

- anything other than exactly one statement (`MULTIPLE_STATEMENTS`)
- a top-level statement that is not `SELECT` (`NOT_SELECT`), including `SET`, `COPY` and `DO`
- any non-SELECT statement anywhere in the tree, for example a data-modifying CTE `WITH d AS (DELETE ...) SELECT ...`
- `SELECT INTO` and `FOR UPDATE/SHARE` (`FORBIDDEN_CLAUSE`)
- relations in another schema, in `pg_catalog`/`information_schema`, named `pg_*`, or with a database name (`FORBIDDEN_RELATION`)
- functions that change session state or run dynamic SQL: `set_config` (which could switch to another workspace's role),
  `query_to_xml` and friends, advisory locks, server file access, `dblink`, large objects (`FORBIDDEN_FUNCTION`)

As a second layer, the original DROP / DELETE / ALTER / TRUNCATE / INSERT / UPDATE / CREATE / GRANT /
REVOKE / COPY denylist is applied to keyword tokens from the scanner. Words inside string literals,
quoted identifiers and comments are not keywords, so `WHERE status = 'deleted'` is allowed.

The query is then sent with the extended query protocol, which PostgreSQL refuses for strings containing more than one statement.

- **Prevents:** the multi-statement bypass found in the audit (`select 1; update ...`), role switching
  with `set_config`, and returns a clear error code the agent can learn from.
- **Does not prevent:** expensive but valid SELECTs (handled by the timeout), and functions not on the denylist.
  The denylist is a convenience; the role in control 2 is the real boundary.

### 5. Row cap and pagination

The checked statement is wrapped as `SELECT * FROM (<sql>) AS dc_result LIMIT <pageSize + 1> OFFSET <n>`.
`pageSize` is capped at 1000 (default 100). One extra row is fetched to report `hasMore`.

- **Prevents:** a `SELECT *` on a large table sending every row to the browser or into the LLM prompt.
- **Does not prevent:** the database doing the full work of a query with a large `ORDER BY`; the timeout limits that.

### 6. Workspace checks on REST and WebSocket

- `GET/DELETE /api/files/:id`, sample queries and text-to-SQL now load files with
  `WHERE id = $1 AND workspace_id = $2` and answer 404 otherwise (fixes the IDOR from the audit).
- Socket.io connections must send the JWT in the handshake. Each socket joins `workspace:<id>` and
  every event (chat, uploads, queries) is emitted only to that room.
- CORS is limited to `FRONTEND_URL` (plus localhost in development).

## Known gaps

- **Workspace membership is self-asserted.** Anyone who registers with the workspace string `team1`
  joins `team1`. Invitations or an owner approval step would fix this; it is a product change outside this phase.
- JWTs are stored in `localStorage` and last 7 days, so an XSS bug would expose them. Refresh tokens in
  httpOnly cookies are an optional item in the plan and are not done yet.
- No rate limiting yet (Phase 9).

## Tests

`backend/tests/sqlGuard.test.ts` (parser unit tests) and `backend/tests/security.test.js`
(HTTP tests against a real PostgreSQL) show that DROP, DELETE, UPDATE, INSERT, ALTER, multi-statement input,
another workspace's schema, the users table, other app tables, and long-running queries are all rejected or time out,
that rows are capped, and that the reader role blocks writes and app-table reads even when the parser is skipped.

```bash
cd backend && npm test
```
