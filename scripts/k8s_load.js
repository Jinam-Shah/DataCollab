// CPU load for the HPA demo: many concurrent cache-busting aggregate queries against the API.
//   node scripts/k8s_load.js http://datacollab.localhost:8080 180
const [base = 'http://datacollab.localhost:8080', seconds = '180', concurrency = '40'] = process.argv.slice(2);

async function main() {
  const name = `load${Date.now().toString(36)}`;
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, email: `${name}@load.dev`, password: 'load1234', workspaceId: name }),
  });
  const { token } = await reg.json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const end = Date.now() + Number(seconds) * 1000;
  let done = 0;
  let failed = 0;
  const worker = async (w) => {
    for (let i = 0; Date.now() < end; i++) {
      // A different constant each time defeats the cache, so every request costs CPU (parsing + JSON).
      const res = await fetch(`${base}/api/queries/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: `SELECT g % 97 AS k, count(*), sum(g * ${w + i}) FROM generate_series(1, 20000) g GROUP BY 1`,
          pageSize: 1000,
        }),
      }).catch(() => null);
      if (res && res.ok) done++;
      else failed++;
      if (res) await res.arrayBuffer();
    }
  };
  await Promise.all(Array.from({ length: Number(concurrency) }, (_, w) => worker(w)));
  console.log(JSON.stringify({ requests: done, failed }));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
