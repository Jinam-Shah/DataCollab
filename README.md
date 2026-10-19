# DataCollab: collaborative SQL workspace with an AI data agent

[![CI](https://github.com/Jinam-Shah/DataCollab/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Jinam-Shah/DataCollab/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Teams upload CSVs and documents, query them with SQL or plain English, chart the results and
chat in real time. An AI agent built with LangGraph.js reads the schema, writes SQL, runs it
through a read-only safety layer, retries on errors, and answers with the SQL it used and
citations to documents. The same tools are available to any MCP client.

![Dashboard](./screenshots/dashboard.png)

**Live demo:** not deployed yet. `infra/terraform` defines the free-tier hosting (Vercel, Render,
Neon, Upstash); see [Deployment](#deployment). Once it is live, the demo login is
`demo@datacollab.dev` / `demo1234`. The free tier sleeps when idle, so the first request can take about a minute.

---

## Architecture

```mermaid
flowchart LR
  U[Browser: React + Vite, Monaco, Recharts] -->|REST + Socket.io| API[Node.js Express API]
  API --> PG[(PostgreSQL 16 + pgvector)]
  API --> R[(Redis: cache, rate limits, BullMQ, Socket.io fan-out)]
  API --> Q[BullMQ worker: CSV ingestion]
  Q --> PG
  API --> AG[LangGraph.js agent]
  AG -->|function calling| LLM[Gemini API or any OpenAI-compatible model]
  AG --> T1[get_schema]
  AG --> T2[run_readonly_query]
  AG --> T3[search_documents: hybrid RAG]
  AG --> T4[summarize_result]
  T2 --> RO[(read-only role, one schema per workspace)]
  MCP[MCP server: stdio + HTTP] --> T1 & T2 & T3
  API -. OpenTelemetry .-> OBS[Grafana: Tempo traces, Prometheus metrics]
```

```mermaid
stateDiagram-v2
  [*] --> plan
  plan --> search_documents: needs documents
  plan --> get_schema: needs tables
  search_documents --> get_schema: needs both
  search_documents --> answer_documents: documents only
  get_schema --> write_sql
  write_sql --> run_sql
  run_sql --> check_result
  check_result --> write_sql: error or empty result, retries < 3
  check_result --> answer: success
  check_result --> give_up: 3 retries used
  answer --> [*]
  answer_documents --> [*]
  give_up --> [*]
```

## Features

**Data**
- CSV upload with type inference over every row (integer, float, date, timestamp, text) and a **quality report**: empty %, mixed types, duplicates, numeric and date ranges, with warnings before the first query.
- Files over 1 MB load in the background through **BullMQ**, with live progress over Socket.io and retries with backoff.
- Monaco SQL editor, paginated results, bar/line/pie charts.

**AI**
- **Agent** (LangGraph.js, LangChain.js tools with zod schemas, Gemini function calling): plan → schema → SQL → run → check, with up to 3 retries that feed the database error back. Steps stream to the UI; every answer shows its SQL with *Open in editor*.
- **Single-shot** NL-to-SQL kept as a baseline mode.
- **RAG** over PDF/Markdown/TXT: chunks with page and section references, local `all-MiniLM-L6-v2` embeddings, **hybrid search** (pgvector HNSW + PostgreSQL full-text, reciprocal rank fusion), clickable citations.
- **Tracing** of every run and step (prompt, tool input/output, error, latency, tokens) in `agent_runs` / `agent_steps`, with a Run history page and an analysis notebook.
- **MCP server** (`list_tables`, `describe_table`, `run_readonly_query`, `search_documents`) over stdio and Streamable HTTP, with workspace API tokens. See [docs/MCP.md](docs/MCP.md).

**Safety and operations**
- Model- and user-written SQL runs as a **read-only role** that can only see one workspace's schema, with a 5 s statement timeout, a **single-statement check** using PostgreSQL's own parser, a keyword denylist and a 1000-row cap. See [docs/SECURITY.md](docs/SECURITY.md).
- **Redis** query cache keyed by data version (never stale) and per-user sliding-window **rate limits**.
- **OpenTelemetry** traces and metrics with a provisioned **Grafana** dashboard. See [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md).
- Real-time chat, upload and query events in authenticated per-workspace Socket.io rooms (Redis adapter across replicas).

## Results

All numbers are measured; commands and environments are in [METRICS.md](METRICS.md).

| What | Result |
|---|---|
| Agent accuracy, 40-question eval set (local `qwen2.5-coder:7b`) | single-shot 77.5% → agent 80.0% → agent + column profiles **82.5%** (hard questions 38.5% → 53.8%); prompt B 77.5%. Differences are not significant (McNemar p ≥ 0.625). |
| Document retrieval hit rate @5, held-out questions | hybrid **80%** vs vector-only 60% (MRR 0.602 vs 0.567) |
| CSV ingest | 100,000 rows in 2.5 s end to end; the API answers the upload in about 50 ms (background job) |
| Query cache | p95 126.6 ms → **15.5 ms**, 108 → 997 req/s (aggregate over 100K rows, 10 connections) |
| Tests | 136 backend (Jest + Supertest, real PostgreSQL and Redis), 14 frontend (Vitest), 3 end-to-end (Playwright, including a two-browser real-time sync test) |

The eval set is a fixed development set used while building the agent, so it shows differences
between configurations, not expected accuracy on new questions. No Gemini key was available in
the build environment; rerun `npm run eval` with `LLM_PROVIDER=gemini` for Gemini numbers.

![Grafana dashboard](./screenshots/grafana-dashboard.png)

## Tech stack

| Area | Tools |
|---|---|
| Frontend | React 19, Vite, Tailwind, Monaco, Recharts, Socket.io client |
| Backend | Node.js 22, Express, TypeScript (gradual, `allowJs`), Socket.io, BullMQ, ioredis |
| Data | PostgreSQL 16 + pgvector, libpg-query, Redis |
| AI | LangGraph.js, LangChain.js, `@langchain/google-genai` (Gemini), OpenAI-compatible models via Ollama, transformers.js embeddings, MCP TypeScript SDK |
| Quality | Jest, Supertest, Vitest, React Testing Library, Playwright, ESLint, Prettier |
| Ops | Docker, Docker Compose, GitHub Actions, Kubernetes (kind, Kustomize, HPA), Terraform, OpenTelemetry, Grafana |

## Run it locally

### With Docker Compose (everything)

```bash
docker compose up --build
docker compose exec api node dist/scripts/seed_demo.js   # optional demo data
```

App: http://localhost:3000 · API: http://localhost:5000. Add the observability stack with
`docker compose -f docker-compose.yml -f docker-compose.observability.yml up --build`
(Grafana on http://localhost:3001).

### Without Docker

Prerequisites: Node.js 22, PostgreSQL 16 with the `pgvector` extension, optionally Redis, and a
[Gemini API key](https://aistudio.google.com/app/apikey) (free).

```bash
# Backend
cd backend
npm install
cp .env.example .env          # set DATABASE_URL, DATABASE_READER_URL, JWT_SECRET, GEMINI_API_KEY
createdb datacollab
npm run migrate               # creates tables, the read-only role, pgvector
npm run seed:demo             # optional: demo account and public dataset
npm run dev                   # API on http://localhost:5000
npm run worker                # only if REDIS_URL is set

# Frontend
cd ../frontend
npm install
cp .env.example .env          # VITE_API_URL=http://localhost:5000
npm run dev                   # http://localhost:3000
```

To use a free local model instead of Gemini: `LLM_PROVIDER=openai OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=qwen2.5-coder:7b` with [Ollama](https://ollama.com).

## Tests and evaluation

```bash
cd backend && npm test                 # Jest + Supertest (needs PostgreSQL; TEST_DATABASE_URL)
cd frontend && npm test                # Vitest
cd frontend && npx playwright test     # end to end, starts its own API and frontend
cd backend && npm run eval             # agent evaluation (see eval/run.ts for options)
cd backend && npm run eval:retrieval   # document retrieval evaluation
```

CI runs lint, format, typecheck, all three test suites, a Docker build, Kubernetes manifest
validation and `terraform validate` on every push and pull request.

## Deployment

- **Free hosting:** `infra/terraform` defines Neon, Upstash, Render and Vercel. [infra/terraform/README.md](infra/terraform/README.md) lists the steps, including the manual ones.
- **Continuous deployment:** `.github/workflows/deploy.yml` deploys `main` after CI passes.
- **Kubernetes:** `make k8s-up` runs everything on a local kind cluster, with an autoscaler on the API. See [k8s/README.md](k8s/README.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/AUDIT.md](docs/AUDIT.md) | What the project looked like before the upgrade, and the bugs found |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model and what each SQL control does and does not prevent |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Design decisions with the options considered |
| [METRICS.md](METRICS.md) | Every measured number, with environment and command |
| [docs/MCP.md](docs/MCP.md) | Connecting MCP clients |
| [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md) | Traces, metrics and the dashboard |

## Known limitations

- Workspace membership is self-asserted: anyone who registers with a workspace ID joins it.
- JWTs live in `localStorage` for 7 days; refresh tokens in httpOnly cookies are not implemented.
- Eval numbers come from a local 7B model on a 40-question development set; Gemini results and a held-out SQL set are still to do.
- The kind cluster and the free-tier deployment are defined and validated but have not been run end to end yet.
- On free hosting, uploads are ingested in the API process, and an upload in progress is lost if the instance spins down.
- The frontend bundle is about 915 KB gzipped because Monaco is bundled.

## Screenshots

| | |
|---|---|
| ![Login](./screenshots/login.png) | ![File upload](./screenshots/file-upload.png) |
| ![Query editor](./screenshots/query-editor.png) | ![Visualizations](./screenshots/visualizations.png) |
| ![AI text-to-SQL](./screenshots/ai-text-to-sql.png) | ![Chat](./screenshots/chat.png) |

The screenshots above predate the upgrade (agent panel, quality report and documents panel are newer).

## Author

**Jinam Shah** · [GitHub @Jinam-Shah](https://github.com/Jinam-Shah)

## License

MIT
