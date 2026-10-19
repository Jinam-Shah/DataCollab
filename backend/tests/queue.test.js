// The BullMQ path: API enqueues, a worker loads the file, QueueEvents relays progress.
// Needs Redis (TEST_REDIS_URL, default redis://localhost:6379). CI runs a Redis service.
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379';
process.env.INLINE_UPLOAD_MAX_BYTES = '100';
process.env.INGEST_BATCH_ROWS = '500';

const { registerUser } = require('./helpers/api');
const queue = require('../ingest/queue');

const csvText =
  'id,city,temp\n' +
  Array.from({ length: 2000 }, (_, i) => `${i},c${i % 7},${(i % 40) - 5}.5`).join('\n');

let worker;
let events;
const received = [];

beforeAll(async () => {
  worker = queue.startWorker(1);
  events = queue.relayQueueEvents();
  await events.waitUntilReady();
  await worker.waitUntilReady();
  queue.setBroadcaster((workspace, event, payload) => received.push({ workspace, event, payload }));
});

afterAll(async () => {
  await worker.close();
  await events.close();
  await queue.closeQueue();
});

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

it('loads a large upload through BullMQ and reports progress to the workspace', async () => {
  const user = await registerUser('queue-team');
  const res = await user.upload('weather.csv', csvText);
  expect(res.status).toBe(202);
  const fileId = res.body.file.id;

  await waitFor(async () => (await user.get(`/api/files/${fileId}`)).body.file.status === 'ready');

  const result = await user.query('SELECT count(*)::int AS n, min(temp) AS lo FROM weather');
  expect(result.body.data[0]).toEqual({ n: 2000, lo: -5.5 });

  const ready = await waitFor(() =>
    received.find((e) => e.event === 'file:ready' && e.payload.fileId === fileId)
  );
  expect(ready.workspace).toBe('queue-team');
  const progress = received.filter(
    (e) => e.event === 'file:progress' && e.payload.fileId === fileId
  );
  expect(progress.length).toBeGreaterThanOrEqual(4);
  expect(progress.every((e) => e.workspace === 'queue-team')).toBe(true);
});
