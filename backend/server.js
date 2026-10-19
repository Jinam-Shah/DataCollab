require('dotenv').config();
// Must run before express, pg and ioredis are required, so they get instrumented.
require('./observability/telemetry').startTelemetry('datacollab-api');
const { createApp } = require('./app');
const pool = require('./config/database');
const { migrate } = require('./db/migrate');
const { initSqlGuard } = require('./security/sqlGuard');

async function main() {
  if (process.env.RUN_MIGRATIONS === 'true') await migrate();
  await initSqlGuard();

  const { rows } = await pool.query('SELECT NOW()');
  console.log('Database connected at:', rows[0].now);

  const { server } = createApp();

  const queue = require('./ingest/queue');
  if (queue.queueEnabled()) {
    queue.relayQueueEvents();
    // On hosts without a separate background worker (e.g. Render free tier), consume jobs here.
    if (process.env.RUN_WORKER_IN_API === 'true') queue.startWorker();
  }
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

main().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
