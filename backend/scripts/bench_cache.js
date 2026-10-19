// Query latency under load, with or without the result cache, using autocannon.
//   node scripts/bench_cache.js <label> <file.csv> [apiUrl] [seconds] [connections]
// Run it once against an API started with QUERY_CACHE_TTL_SECONDS=0 and once with the cache on.
// Every response time is recorded from autocannon's 'response' event so p50/p95 are exact.
const fs = require('fs');
const path = require('path');
const autocannon = require('autocannon');

const [label = 'run', file, api = 'http://localhost:5000', seconds = '20', connections = '10'] =
  process.argv.slice(2);

async function json(res) {
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function main() {
  const name = `cache${Date.now().toString(36)}`;
  const { token } = await json(
    await fetch(`${api}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: name,
        email: `${name}@bench.dev`,
        password: 'bench123',
        workspaceId: name,
      }),
    })
  );
  const auth = { Authorization: `Bearer ${token}` };

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'text/csv' }), path.basename(file));
  const up = await json(
    await fetch(`${api}/api/files/upload`, { method: 'POST', headers: auth, body: form })
  );
  let table;
  for (;;) {
    const f = (await json(await fetch(`${api}/api/files/${up.file.id}`, { headers: auth }))).file;
    if (f.status === 'ready') {
      table = f.tableName;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // A typical dashboard query: an aggregate over the whole table.
  const body = JSON.stringify({
    query: `SELECT region, product, count(*) AS orders, round(sum(quantity * unit_price)::numeric, 2) AS revenue
              FROM ${table} GROUP BY region, product ORDER BY revenue DESC`,
  });
  const headers = { ...auth, 'Content-Type': 'application/json' };
  // Warm-up request (fills the cache when it is enabled).
  const warm = await json(
    await fetch(`${api}/api/queries/execute`, { method: 'POST', headers, body })
  );

  const latencies = [];
  let non2xx = 0;
  const instance = autocannon({
    url: `${api}/api/queries/execute`,
    method: 'POST',
    headers,
    body,
    connections: Number(connections),
    duration: Number(seconds),
  });
  instance.on('response', (client, statusCode, bytes, responseTime) => {
    latencies.push(responseTime);
    if (statusCode >= 300) non2xx++;
  });
  const result = await instance;
  latencies.sort((a, b) => a - b);

  console.log(
    JSON.stringify(
      {
        label,
        requests: latencies.length,
        non2xx,
        connections: Number(connections),
        durationSeconds: Number(seconds),
        requestsPerSecond: Math.round(result.requests.average),
        p50Ms: Number(pct(latencies, 50).toFixed(1)),
        p95Ms: Number(pct(latencies, 95).toFixed(1)),
        p99Ms: Number(pct(latencies, 99).toFixed(1)),
        cachedWarmup: warm.cached,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
