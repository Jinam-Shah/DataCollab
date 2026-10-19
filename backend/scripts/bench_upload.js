// End-to-end upload benchmark against a running API.
//   node scripts/bench_upload.js <file.csv> [apiUrl]
// Measures: time until the upload request returns, time until the file is 'ready'
// (queued -> parsed -> loaded), and /health latency while the load is running.
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const api = process.argv[3] || process.env.API_URL || 'http://localhost:5000';
if (!file) {
  console.error('usage: node scripts/bench_upload.js <file.csv> [apiUrl]');
  process.exit(1);
}

async function json(res) {
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const name = `bench${Date.now().toString(36)}`;
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

  const t0 = performance.now();
  const upload = await json(
    await fetch(`${api}/api/files/upload`, { method: 'POST', headers: auth, body: form })
  );
  const acceptedMs = performance.now() - t0;

  const healthMs = [];
  let details;
  for (;;) {
    const h0 = performance.now();
    await fetch(`${api}/health`);
    healthMs.push(performance.now() - h0);
    details = (await json(await fetch(`${api}/api/files/${upload.file.id}`, { headers: auth })))
      .file;
    if (details.status === 'ready' || details.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const readyMs = performance.now() - t0;
  healthMs.sort((a, b) => a - b);

  console.log(
    JSON.stringify(
      {
        file: path.basename(file),
        bytes: fs.statSync(file).size,
        status: details.status,
        rows: details.rowCount,
        httpStatus: upload.jobId ? 202 : 201,
        uploadResponseMs: Math.round(acceptedMs),
        endToEndMs: Math.round(readyMs),
        workerIngestMs: details.ingestMs,
        healthChecks: healthMs.length,
        healthP50Ms: Math.round(healthMs[Math.floor(healthMs.length * 0.5)]),
        healthMaxMs: Math.round(healthMs[healthMs.length - 1]),
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
