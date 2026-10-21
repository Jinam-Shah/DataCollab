# Metrics

Every number here was measured, not estimated. Each row lists the date, the environment and the exact command, so it can be reproduced.

| Date | Metric | Value | Environment | How it was measured |
|---|---|---|---|---|
| 2026-10-19 | CSV ingest, 10,000 rows (673 KB), inline path | 295 ms end to end (median of 3; runs 293, 295, 295) | Cloud dev container: 4 vCPU Intel Xeon 2.1 GHz, 15 GB RAM; PostgreSQL 16.15 and Redis 7.0.15 on the same host; API + 1 worker, `node dist/*` | `node scripts/make_csv.js 10000 sales_10000.csv && node scripts/bench_upload.js sales_10000.csv` |
| 2026-10-19 | CSV ingest, 50,000 rows (3.4 MB), BullMQ path | 1,391 ms end to end (median of 3; runs 1,365, 1,391, 1,419); upload request answered in 41 ms (202) | same | `node scripts/make_csv.js 50000 sales_50000.csv && node scripts/bench_upload.js sales_50000.csv` |
| 2026-10-19 | CSV ingest, 100,000 rows (6.9 MB), BullMQ path | 2,546 ms end to end (median of 3; runs 2,658, 2,546, 2,489); upload request answered in 51 ms (202) | same | `node scripts/make_csv.js 100000 sales_100000.csv && node scripts/bench_upload.js sales_100000.csv` |
| 2026-10-19 | API responsiveness during a 100,000-row ingest | `/health` max 4–7 ms across 3 runs (about 50 checks per run) | same | `bench_upload.js` field `healthMaxMs` |
| 2026-10-19 | Backend automated tests | 98 tests in 8 suites, all passing; coverage 73.5% lines, 69.2% branches | Same container, PostgreSQL 16 + Redis 7 local | `cd backend && npm run test:coverage` |
| 2026-10-19 | Frontend component tests | 13 tests in 5 files (Vitest + React Testing Library), all passing; coverage 35.7% lines | Same container, jsdom | `cd frontend && npm run test:coverage` |
| 2026-10-19 | End-to-end tests | 3 Playwright tests (sign-up → upload → quality report → query → chart → agent with mocked LLM → run history; write blocked; two-session real-time sync), all passing on 2 consecutive runs | Same container, Chromium 141 | `cd frontend && npx playwright test` |
| 2026-10-19 | Docker images | API/worker image 107 MB compressed (509 MB unpacked); web image 22 MB compressed (78.6 MB) | Docker 29.9 | `docker build -t datacollab-api backend && docker build -t datacollab-web frontend` |
| 2026-10-19 | CSV ingest in Docker Compose, 50,000 rows | 2,195 ms end to end via separate worker container (single run) | Same container, `docker compose` stack | `node scripts/bench_upload.js sales_50000.csv http://localhost:15000` |
| 2026-10-19 | Retrieval hit rate @5, dev set (25 questions), keyword ranking v1 (AND→OR, `ts_rank_cd`) | vector 21/25 (84.0%), keyword 14/25 (56.0%), hybrid RRF 20/25 (80.0%); MRR@5 0.620 / 0.427 / 0.541 | Corpus: 3 CDC NCHS mortality data briefs (PDF, 2016–2018) + demo data dictionary = 4 docs, 104 chunks; embeddings all-MiniLM-L6-v2 (q8, local); same container | `EMBEDDINGS_PROVIDER=local npm run eval:retrieval -- --keyword-ranking cover_density` |
| 2026-10-19 | Retrieval hit rate @5, dev set, keyword ranking v2 (OR, `ts_rank` with length normalization), chosen on this set | vector 21/25 (84.0%), keyword 21/25 (84.0%), hybrid RRF 24/25 (96.0%); MRR@5 0.620 / 0.563 / 0.698 | same | `EMBEDDINGS_PROVIDER=local npm run eval:retrieval -- --keyword-ranking rank` |
| 2026-10-19 | Retrieval hit rate @5, held-out set (15 questions written after choosing v2), v1 ranking | vector 9/15 (60.0%), keyword 11/15 (73.3%), hybrid 12/15 (80.0%); MRR@5 0.567 / 0.441 / 0.511 | same | `npm run eval:retrieval -- --set eval/retrieval_holdout.jsonl --keyword-ranking cover_density` |
| 2026-10-19 | Retrieval hit rate @5, held-out set, v2 ranking (default) | vector 9/15 (60.0%), keyword 12/15 (80.0%), hybrid 12/15 (80.0%); MRR@5 0.567 / 0.517 / 0.602 | same | `npm run eval:retrieval -- --set eval/retrieval_holdout.jsonl --keyword-ranking rank` |
| 2026-10-19 | Eval: single-shot NL-to-SQL baseline (40 questions) | 31/40 correct (77.5%); hard 5/13 (38.5%); median 11.1 s/question | Local LLM `qwen2.5-coder:7b` (Q4_K_M) via Ollama 0.40.6, CPU only, same 4-vCPU container; demo dataset | `LLM_PROVIDER=openai OPENAI_MODEL=qwen2.5-coder:7b npm run eval -- --mode single_shot --profiles off` |
| 2026-10-19 | Eval: agent, prompt A, no column profiles | 32/40 (80.0%); hard 6/13 (46.2%); median 26.6 s; mean 1.10 attempts | same | `... npm run eval -- --mode agent --variant A --profiles off` |
| 2026-10-19 | Eval: agent, prompt A, with column profiles in get_schema (improvement experiment) | 33/40 (82.5%); hard 7/13 (53.8%); median 31.0 s; mean 1.02 attempts | same | `... npm run eval -- --mode agent --variant A --profiles on` |
| 2026-10-19 | Eval: agent, prompt B, with column profiles (prompt A/B experiment) | 31/40 (77.5%); hard 6/13 (46.2%); median 32.2 s; mean 1.23 attempts | same | `... npm run eval -- --mode agent --variant B --profiles on` |
| 2026-10-19 | McNemar exact test, paired on the 40 questions | single-shot vs agent A: 1 vs 2 discordant, p = 1.000; profiles off vs on: 0 vs 1, p = 1.000; prompt A vs B: 3 vs 1, p = 0.625. No difference is significant at this sample size | same | `analysis/agent_runs.ipynb`, section 4 |
| 2026-10-19 | Retry effectiveness (all eval agent runs) | SQL error rate: attempt 1 3.6% (168 runs); attempt 2 37.5% (8); attempts 3 and 4 100% (3 each) | same | `analysis/agent_runs.ipynb`, section 3 |
| 2026-10-19 | Query latency without cache (aggregate over 100,000 rows, 10 connections, 20 s) | p50 89.9 ms, p95 126.6 ms, p99 146.9 ms; 108 req/s; 2,157 requests, 0 errors | Same container, quiet CPU; API `node dist/server.js` with `QUERY_CACHE_TTL_SECONDS=0`; PostgreSQL 16 and Redis 7 local | `node scripts/bench_cache.js cache_off sales_100000.csv http://localhost:5300 20 10` (autocannon) |
| 2026-10-19 | Query latency with Redis cache (same query and load) | p50 9.4 ms, p95 15.5 ms, p99 20.7 ms; 997 req/s; 19,935 requests, 0 errors | Same, `QUERY_CACHE_TTL_SECONDS=300`, `REDIS_URL=redis://localhost:6379` | `node scripts/bench_cache.js cache_on sales_100000.csv http://localhost:5300 20 10` |
| 2026-10-19 | Eval: Gemini single-shot baseline (40 questions) | 37/40 (92.5%); hard 10/13 (76.9%); median 0.6 s/question | `gemini-3.5-flash-lite`, Gemini API free tier (15 requests/min measured), same container and demo dataset | `LLM_PROVIDER=gemini GEMINI_MODEL=gemini-3.5-flash-lite EVAL_DELAY_MS=8000 npm run eval -- --mode single_shot --profiles off --label gemini-single_shot-profiles_off` |
| 2026-10-19 | Eval: Gemini agent, prompt A, no column profiles | **38/40 (95.0%)**; hard 11/13 (84.6%); median 1.1 s; mean 1.02 attempts | same | `... npm run eval -- --mode agent --variant A --profiles off --label gemini-agent-A-profiles_off` |
| 2026-10-19 | Eval: Gemini agent, prompt A, with column profiles | 36/40 (90.0%); hard 9/13 (69.2%); median 1.2 s | same | `... --mode agent --variant A --profiles on --label gemini-agent-A-profiles_on` |
| 2026-10-19 | Eval: Gemini agent, prompt B, with column profiles | 36/40 (90.0%); hard 9/13 (69.2%); median 1.3 s | same | `... --mode agent --variant B --profiles on --label gemini-agent-B-profiles_on` |
| 2026-10-19 | McNemar exact test, Gemini runs | single-shot vs agent A: 1 vs 2 discordant, p = 1.000; profiles off vs on: 2 vs 0, p = 0.500; prompt A vs B: 1 vs 1, p = 1.000. None significant | same | `analysis/agent_runs.ipynb`, section 4 |
| 2026-10-19 | Gemini free-tier rate limits (measured with a new key) | `gemini-3.8-flash`: 5 requests/min; `gemini-3.5-flash-lite`: 15 requests/min (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`) | Gemini API | burst of `generateContent` calls until HTTP 429, reading the quota violation |
| 2026-10-21 | Backend automated tests (after the per-table tabs, row browsing, CSV download and scoped AI questions) | 144 tests in 13 suites, all passing; coverage 76.7% lines, 69.8% branches | Same container, PostgreSQL 16 + Redis 7 local | `cd backend && npm run test:coverage` |
| 2026-10-21 | Frontend component tests | 22 tests in 9 files, all passing; coverage 48.0% lines, 49.2% branches | Same container, jsdom | `cd frontend && npm run test:coverage` |
| 2026-10-21 | End-to-end tests | 6 Playwright tests (main flow incl. all-rows browsing, CSV download, per-table SQL and Ask AI; write blocked; document upload and viewer; MCP token snippet; Ask AI source picker; two-session real-time sync), all passing on 2 consecutive runs | Same container, Playwright 1.56.1, Chromium | `cd frontend && npx playwright test` |

## Notes on the evaluation numbers

- **Models.** Two models were evaluated on the same questions: a free local model
  (`qwen2.5-coder:7b` on CPU) and Gemini (`gemini-3.5-flash-lite`, free tier). Quote each number
  with its model. `gemini-2.5-flash` is no longer offered to new API keys, and `gemini-3.8-flash`
  allows only 5 requests/min on the free tier, so `gemini-3.5-flash-lite` was used.
- **Development set.** The 40 questions were written while building the agent. The scores show
  differences on this set, not expected accuracy on unseen questions. No held-out SQL set has been run yet.
- **Significance.** With 40 paired questions, the 1–3 question differences between configurations
  are not statistically significant for either model (McNemar p ≥ 0.5). The honest summary: the
  model matters far more than the configuration (local 7B 77.5–82.5%, Gemini 90–95%); the agent
  with prompt A was the best or joint-best setup for both; column profiles helped the 7B model by
  one question and cost Gemini two; prompt B never helped, so prompt A is the default.
- **Failure analysis** (`analysis/agent_runs.ipynb`): across all eight runs only h13 ("How many
  people died in Texas in 2016?") fails every time: every model sums all causes instead of using
  the "All causes" row. For the local model alone, six questions fail in every configuration.
  Two are traps the demo data dictionary documents ("All causes" double counting, lowercase
  network codes), two read "increase between 1999 and 2017" as a sum over years, one invents a
  `region` column instead of joining, and one answers "how many died" with population numbers.
- **Retries help rarely.** First-attempt SQL errors were only 3.6%, so most failures are runnable
  but wrong SQL, which retrying on errors cannot catch.
