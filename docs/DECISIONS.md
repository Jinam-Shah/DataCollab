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

## D9. A scripted fake LLM for end-to-end tests

- **Problem:** Playwright tests must exercise the agent UI, including the retry path, without calling a real model.
- **Choice:** `LLM_PROVIDER=fake` loads `agent/fakeModel.ts`, which answers each graph step from a JSON script (`frontend/e2e/fake-llm.json`). It refuses to start with `NODE_ENV=production`.
- **Why:** the real graph, tools, safety layer, tracing and socket streaming all run; only the text generation is replaced. Unit tests use a separate in-process scripted model.

## D10. Bundle Monaco instead of loading it from a CDN

- **Problem:** `@monaco-editor/react` downloads Monaco from jsDelivr at runtime, which made e2e tests depend on an external CDN and added a third-party runtime dependency.
- **Choice:** import the core editor and the SQL language from the `monaco-editor` package and pass it to the loader (`src/monacoSetup.js`).
- **Cost:** the main bundle is now about 915 KB gzipped. Lazy-loading the editor is a possible follow-up.

## D11. Local embeddings (all-MiniLM-L6-v2 via transformers.js)

- **Problem:** document chunks and queries need embeddings, on free services only.
- **Options:** Gemini embedding API (free tier, rate limited, needs a key); OpenAI (paid); a local model in Node.
- **Choice:** `Xenova/all-MiniLM-L6-v2` (384 dimensions, 8-bit quantized) through `@huggingface/transformers`, running in the API process. `EMBEDDINGS_PROVIDER=gemini` switches to `gemini-embedding-001` truncated to 384 dimensions; `hash` is a deterministic stand-in for tests.
- **Why:** no rate limits, no key, no network at query time, and evaluations are reproducible. Loading the model takes about 1 s, and embedding a query about 10–20 ms on CPU. Cost: onnxruntime adds roughly 290 MB to `node_modules`, and about 100 MB of RAM while loaded. `.npmrc` skips its optional GPU download.

## D12. Hybrid retrieval with reciprocal rank fusion, and the keyword ranking change

- **Problem:** vector search misses exact numbers and names; keyword search misses paraphrases.
- **Choice:** retrieve 20 candidates from each (pgvector HNSW cosine, PostgreSQL full-text search) and merge with reciprocal rank fusion, `score = Σ 1 / (60 + rank)`. RRF uses ranks, not raw scores, so cosine distances and `ts_rank` values never need to be put on the same scale.
- **What the measurement changed:** the first keyword retriever (an AND query falling back to OR, ranked by `ts_rank_cd`) found only 14/25 dev questions, and fusing it made hybrid *worse* than vector alone (80% against 84%). Ranking an OR query with `ts_rank(..., 1)` (normalized by chunk length) raised keyword to 21/25 and hybrid to 24/25. That change was chosen on the dev questions, so 15 new held-out questions were written afterwards: there, hybrid (80%) beats vector-only (60%), hit rate is the same for both keyword rankings (12/15), and MRR improves from 0.511 to 0.602. See METRICS.md.

## D13. MCP server: one workspace per token, stateless HTTP

- **Problem:** MCP clients need access to one workspace's data without a user's login session.
- **Choice:** workspace-scoped API tokens (random 24 bytes, stored as SHA-256), a server instance per request bound to the token's workspace, and Streamable HTTP in stateless mode at `/mcp`, plus stdio for local clients.
- **Why:** tokens can be revoked one by one and never appear in the database in plain text. Stateless HTTP works behind any load balancer and on hosts that sleep (Render free tier), because no session is kept in memory. All tools reuse the Phase 1 path, so a client can do nothing a logged-in user could not.

## D14. Selected OpenTelemetry instrumentations plus custom metrics

- **Problem:** we need request, database, agent and cache visibility without much overhead.
- **Options:** `auto-instrumentations-node` (instruments around 40 libraries); only the libraries we use.
- **Choice:** HTTP, Express, pg and ioredis instrumentations, plus four custom instruments. Agent steps become child spans of `agent.run`, created after each step with its measured latency.
- **Why:** smaller dependency tree and startup cost, and every span or metric on the dashboard is one we chose. The custom HTTP histogram is labelled with route patterns (`/api/files/:id`), which keeps the number of Prometheus series bounded.

## D15. Free hosting: Render + Neon + Upstash + Vercel, managed with Terraform

- **Problem:** a public demo on free services only, reproducible from code.
- **Choice:** Vercel Hobby for the static frontend; Render free web service (Docker) for the API; Neon Free for PostgreSQL with pgvector; Upstash Free for Redis. All four have maintained Terraform providers (Vercel and Render partner-tier, Neon and Upstash community), so they are all defined in `infra/terraform`.
- **Free-tier constraints that changed the design:** Render offers no free background workers, so the API ingests uploads itself; `INGEST_QUEUE=inline` keeps BullMQ from polling Upstash all day and using up its 500K monthly commands; `SEED_DEMO=true` replaces a one-off seed command; Render and Neon both sleep when idle, so the first request after a while takes about a minute.
- **Deploy gate:** `deploy.yml` runs only after CI passes on `main` (`workflow_run`), using a Render deploy hook and the Vercel CLI, instead of each platform's auto-deploy on every push.

## D16. Default system prompt: A, after the A/B comparison

- **Problem:** two SQL-writing prompts were written: a short rules list (A) and a longer guide with PostgreSQL tips (B).
- **Result:** on the 40-question eval with a local 7B model, A with column profiles scored 82.5% and B scored 77.5% (3 vs 1 discordant questions, McNemar p = 0.625, not significant).
- **Choice:** A is the default (`AGENT_PROMPT_VARIANT=B` switches). The longer prompt cost more tokens and did not help this model. The result should be re-checked with Gemini.

## D17. Frontend: one page per task instead of a single dashboard

- **Problem:** the single dashboard stacked upload, file details, SQL, the agent, documents and tokens on one page. Clicking a table pushed its details below the grid, documents looked like they vanished after upload (they are not tables, so the file list never showed them), and the token panel gave no context.
- **Choice:** a sidebar layout with routes `/app/data[/:fileId]`, `/app/sql`, `/app/ask`, `/app/documents[/:docId]`, `/app/history`, `/app/integrations`; team chat is a drawer on every page. Selections live in the URL, so links can be shared and the back button works. Old `/dashboard` and `/runs` links redirect.
- **Also fixed:** the socket was created in the dashboard's effect, after children had already subscribed to a null socket, so live list updates could be missed. The layout now creates it before its children render.
