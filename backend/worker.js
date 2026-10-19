// Standalone ingestion worker: `node dist/worker.js` (or `npm run worker` in development).
require('dotenv').config();
const { startWorker, queueEnabled, closeQueue } = require('./ingest/queue');

if (!queueEnabled()) {
  console.error('REDIS_URL is not set; the worker has nothing to consume.');
  process.exit(1);
}

const worker = startWorker();
console.log('Ingestion worker started');

const shutdown = async () => {
  await worker.close();
  await closeQueue();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
