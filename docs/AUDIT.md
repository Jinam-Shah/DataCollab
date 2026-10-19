# Audit of DataCollab (before the upgrade)

Date: 2026-10-19. Audited commit: `e0a2f8d` ("Initial commit").
Method: read every source file, created a local PostgreSQL 16 database from the README schema, ran the
backend and frontend, and called the API with `curl` as two users in different workspaces.

## Folder structure

```
backend/                 Express API, plain JavaScript (CommonJS)
  server.js              App entry: Express, Socket.io, route mounting, /health
  config/database.js     One pg Pool from DATABASE_URL
  middleware/auth.js     JWT Bearer check, sets req.userId / req.username / req.workspaceId
  models/User.js         User queries and bcrypt hashing
  controllers/           auth, file (CSV upload), query (SQL run), ai (Gemini), chat
  services/csvService.js CSV parse, type inference, CREATE TABLE, batch INSERT
  services/sqlService.js Keyword denylist + pool.query of user SQL
  services/geminiService.js  Calls Gemini REST API with the table schema in the prompt
  routes/                One router per controller
  test-db.js, test-upload.html  Manual dev helpers
frontend/                Create React App (react-scripts 5), React 19, Tailwind 3
  src/pages/             LoginPage, RegisterPage, Dashboard
  src/components/        FileUpload, FileList, QueryEditor (Monaco), TextToSQL, ChartBuilder (Recharts), ChatSidebar
  src/services/          axios instance with JWT interceptor, socket.io client
screenshots/             README images
```

## Main routes

| Method | Path | Notes |
|---|---|---|
| POST | /api/auth/register | username, email, password, optional free-text workspaceId |
| POST | /api/auth/login | returns a 7-day JWT containing userId, username, workspaceId |
| GET | /api/auth/profile | |
| POST | /api/files/upload | multer to `uploads/`, 10 MB limit, parse, create `csv_data_<id>`, insert |
| GET | /api/files | files in the caller's workspace |
| GET | /api/files/:id | details + 10-row preview. **No workspace check** |
| DELETE | /api/files/:id | drops the table. **No workspace or owner check** |
| POST | /api/queries/execute | runs arbitrary SQL from the body on the main pool |
| GET | /api/queries/schema/:tableName | information_schema lookup for any table name |
| GET | /api/queries/samples/:fileId | canned queries |
| POST | /api/ai/text-to-sql | Gemini single-shot NL-to-SQL for one file |
| GET/POST | /api/chat/messages | chat history and send |
| GET | /health | |

## Database schema (real table names)

No schema or migration file existed in the repository; the only definition was the SQL block in the
README. It was copied unchanged into `backend/db/migrations/001_initial_schema.sql`.

- `users` (id, username, email, password_hash, workspace_id VARCHAR, created_at)
- `csv_files` (id, user_id → users, original_filename, stored_filename, file_size, row_count, column_count, workspace_id, uploaded_at)
- `csv_columns` (id, file_id → csv_files, column_name, data_type, column_index, sample_values TEXT[])
- `chat_messages` (id, user_id → users, username, message, sent_at). No workspace column; filtered by joining to the sender's *current* workspace.
- Five indexes: users.workspace_id, csv_files.user_id, csv_files.workspace_id, csv_columns.file_id, chat_messages.sent_at DESC.
- One dynamic table per upload, `csv_data_<file_id>`, all in the `public` schema next to the application tables.

A "workspace" is just a string the user types at registration. There is no workspaces table and no
membership control: anyone who registers with the same string joins that workspace.

## How SQL generation works today

1. The client sends `{question, fileId}`.
2. The server reads the columns of `csv_data_<fileId>` from `information_schema` (no workspace check).
3. `geminiService.buildPrompt` lists the table and columns and asks for one PostgreSQL SELECT.
4. The Gemini REST API (`gemini-2.5-flash`, temperature 0.2) is called with axios.
5. `extractSQL` strips code fences and **keeps only the first line** of the answer.
6. The SQL is placed in the Monaco editor. The user clicks Run, which calls `/api/queries/execute`.

## What is verified working

- Register, login, JWT auth, bcrypt hashing.
- CSV upload, type inference, table creation, batch insert of 500 rows per statement in one transaction, 10-row preview.
- Query execution and result table, chart builder, chat.
- `react-scripts build` succeeds.

## What is broken or risky

Security (all reproduced with curl against a local instance):

1. **Any user can read all password hashes.** `SELECT username, password_hash FROM users` through
   `/api/queries/execute` returns every row, because user SQL runs on the application's own connection.
2. **No workspace isolation for data.** A user in workspace `other` can `SELECT * FROM csv_data_1`
   belonging to workspace `team1`. Table names are sequential and easy to guess.
3. **The denylist is bypassable.** `select 1; update csv_data_1 set salary=999` passes (it starts
   with `select` and the denylist has no `update csv_data`) and modified every row. Multi-statement
   strings are executed because the query is sent without parameters (simple query protocol).
4. **IDOR on files.** `GET /api/files/:id` and `DELETE /api/files/:id` do not check the workspace or
   the owner, so any user can read or delete any file.
5. **No statement timeout or row cap.** A slow or huge query ties up the shared pool and returns every row to the browser.
6. **Real-time events go to everyone.** `io.emit` broadcasts chat, upload and query events to all
   connected sockets in all workspaces. Sockets are not authenticated and no rooms are used
   (the README's description of per-workspace rooms is not what the code does).
7. Validation failures throw inside `executeQuery` and surface as HTTP 500 instead of 400.
8. CORS is open to all origins for the REST API (`app.use(cors())`).

Correctness:

9. `parseInt(value) || null` converts `0` to `NULL` (reproduced: salary 0 stored as NULL).
10. Type inference: a column's type is the *last* non-text type seen in the first 100 rows. A column
    with `1.5` then `2` becomes INTEGER and later floats are truncated by `parseInt`. Text found after
    row 100 in a numeric column silently becomes NULL. `MM/DD/YYYY` dates depend on the server's DateStyle.
11. Two headers that sanitize to the same name (`a b`, `a_b`) produce a duplicate-column CREATE TABLE error.
12. `extractSQL` keeps only the first line of Gemini's answer, so multi-line SQL is truncated.
13. The whole CSV is held in memory and inserted inside the HTTP request.

Project hygiene:

14. `backend/package-lock.json` did not match `package.json` (lock had express 5, bcrypt 6, multer 2),
    so `npm ci` failed. Regenerated; multer moved to 2.x and bcrypt to 6.x (multer 1.x has published CVEs).
15. No tests. The only test, CRA's default `App.test.js`, failed (it looks for a "learn react" link).
16. No linter or formatter config beyond CRA's defaults, no CI, no Docker.
17. Create React App is deprecated upstream.

## Phase 0 changes

- Backend: TypeScript compiler with `allowJs` (gradual migration), `tsx` for dev, `tsc` build to `dist/`,
  ESLint (flat config, typescript-eslint), Prettier, Jest with `@swc/jest`, Supertest.
- Backend: `db/migrate.js` runner and `001_initial_schema.sql`. `npm run migrate` replaces pasting SQL from the README.
- Frontend: moved from CRA to Vite (see DECISIONS.md), env vars renamed `REACT_APP_*` → `VITE_*`, ESLint flat config, Vitest.
- `docs/DECISIONS.md` and `METRICS.md` created.

The security items 1–8 are fixed in Phase 1, items 9–13 in Phases 1–2.
