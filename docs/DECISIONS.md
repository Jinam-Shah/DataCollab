# Design decisions

Each entry: the problem, the options, the choice, and why.

## D1. Gradual TypeScript migration with `allowJs`

- **Problem:** the backend is plain CommonJS JavaScript. The plan asks for new modules (agent, RAG, MCP) in TypeScript without rewriting working code.
- **Options:** (a) rewrite everything in TS now; (b) Node's built-in type stripping; (c) `tsc` with `allowJs` compiling JS and TS together into `dist/`, `tsx` in development.
- **Choice:** (c).
- **Why:** JS and TS files can `require` each other, so files are converted only when touched. Type stripping does not support every TS feature and does not type-check. `tsc --noEmit` gives a real type-check step in CI.

## D2. Move the frontend from Create React App to Vite

- **Problem:** CRA (`react-scripts`) is deprecated and pins Jest 27. The plan asks for Vitest.
- **Options:** keep CRA and add Vitest beside it; eject; migrate to Vite.
- **Choice:** Vite, with Vitest sharing the same config.
- **Why:** one build tool for dev, build and tests; much faster startup. The cost was small: renaming two entry files, moving `index.html`, and renaming `REACT_APP_*` env vars to `VITE_*`.

## D3. Own migration runner instead of a migration library

- **Problem:** the schema only existed as a SQL block in the README.
- **Options:** node-pg-migrate, Knex, Prisma, a small runner.
- **Choice:** a ~60-line runner (`backend/db/migrate.js`) applying `.sql` or `.js` files in order and recording them in `schema_migrations`, guarded by an advisory lock.
- **Why:** the app uses raw `pg` everywhere, some migrations need code (creating roles with passwords from env), and a small runner is easy to explain line by line.

## D4. Isolation by database roles, not only by parsing SQL

- **Problem:** user and agent SQL must not read other workspaces or the app tables, and must not write.
- **Options:** (a) a better denylist; (b) parse the SQL and allow-list table names; (c) a schema per workspace plus a SELECT-only role per workspace, entered with `SET LOCAL ROLE` from a `NOINHERIT` read-only login; (d) one login role per workspace with its own pool.
- **Choice:** (c), with (b) as an extra layer.
- **Why:** the database enforces privileges on every code path, including ones a parser misses (views, functions that run dynamic SQL). (d) is equally strong but needs a pool and a password per workspace. The one weakness of (c), switching role with `set_config('role', ...)`, is closed by the parser and by the single-statement rule.

## D5. libpg-query as the SQL parser

- **Problem:** the single-statement check needs to read SQL exactly as PostgreSQL does.
- **Options:** `node-sql-parser` (multi-dialect, hand-written grammar), `pgsql-ast-parser` (PostgreSQL subset, little recent maintenance), `libpg-query` (PostgreSQL's own parser compiled to WebAssembly).
- **Choice:** `libpg-query`.
- **Why:** it accepts every query PostgreSQL accepts and nothing else, so there is no gap between "what the check thinks" and "what the server runs". Its scanner also gives keyword tokens, which lets the old denylist ignore string literals and comments.

## D6. Readable table names per workspace

- **Problem:** tables were named `csv_data_<id>`, which tells the LLM nothing.
- **Choice:** new uploads are named from the file name (`employees.csv` → `employees`), made unique within the workspace. Old tables keep their names.
- **Why:** schemas make names local to a workspace, and meaningful names help both people and the agent write correct SQL.

## D7. Two-pass streaming ingestion

- **Problem:** the original upload read the whole CSV into memory, guessed types from the first 100 rows, and inserted inside the HTTP request.
- **Choice:** pass 1 streams the file to infer types over every row and build the quality report; pass 2 streams it again and inserts in batches of up to 1,000 rows (capped by PostgreSQL's 65,535-parameter limit) inside one transaction.
- **Why:** memory no longer grows with file size (apart from a 16-byte hash per row for duplicate detection), types are correct for the whole column, and a failed attempt rolls back fully, which makes retries safe. Reading the file twice is cheap next to the inserts.

## D8. BullMQ for large uploads, inline for small ones

- **Problem:** a 100K-row file takes seconds to load and must not block the API.
- **Options:** always queue; never queue; queue above a size threshold.
- **Choice:** files over `INLINE_UPLOAD_MAX_BYTES` (1 MB default) become BullMQ jobs (3 attempts, exponential backoff from 2 s). Smaller files load during the request and return the quality report directly. Without `REDIS_URL` the same job function runs in-process with the same retry policy.
- **Why:** small files stay instant and simple; large ones return a job id in ~50 ms (see METRICS.md). Progress goes from the worker to Redis through `job.updateProgress`, and the API's `QueueEvents` listener relays it to the workspace's Socket.io room, so the worker can run as a separate process. On a host without background workers, `RUN_WORKER_IN_API=true` runs the worker inside the API process.
