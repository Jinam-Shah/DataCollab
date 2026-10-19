# Metrics

Every number here was measured, not estimated. Each row lists the date, the environment and the exact command, so it can be reproduced.

| Date | Metric | Value | Environment | How it was measured |
|---|---|---|---|---|
| 2026-10-19 | CSV ingest, 10,000 rows (673 KB), inline path | 295 ms end to end (median of 3; runs 293, 295, 295) | Cloud dev container: 4 vCPU Intel Xeon 2.1 GHz, 15 GB RAM; PostgreSQL 16.15 and Redis 7.0.15 on the same host; API + 1 worker, `node dist/*` | `node scripts/make_csv.js 10000 sales_10000.csv && node scripts/bench_upload.js sales_10000.csv` |
| 2026-10-19 | CSV ingest, 50,000 rows (3.4 MB), BullMQ path | 1,391 ms end to end (median of 3; runs 1,365, 1,391, 1,419); upload request answered in 41 ms (202) | same | `node scripts/make_csv.js 50000 sales_50000.csv && node scripts/bench_upload.js sales_50000.csv` |
| 2026-10-19 | CSV ingest, 100,000 rows (6.9 MB), BullMQ path | 2,546 ms end to end (median of 3; runs 2,658, 2,546, 2,489); upload request answered in 51 ms (202) | same | `node scripts/make_csv.js 100000 sales_100000.csv && node scripts/bench_upload.js sales_100000.csv` |
| 2026-10-19 | API responsiveness during a 100,000-row ingest | `/health` max 4–7 ms across 3 runs (about 50 checks per run) | same | `bench_upload.js` field `healthMaxMs` |
