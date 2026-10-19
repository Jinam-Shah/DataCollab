// Background ingestion queue.
//
// With REDIS_URL set, uploads become BullMQ jobs: the API enqueues and returns at once, a worker
// (worker.js, or the API process itself when RUN_WORKER_IN_API=true) parses and loads the file, and
// the API relays BullMQ progress events to the workspace over Socket.io.
// Without Redis (local dev, tests) the same job runs in this process, with the same retry policy.
import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  ingestFile,
  markFailed,
  type IngestJob,
  type IngestProgress,
  type IngestResult,
} from './ingestFile';

export const QUEUE_NAME = process.env.INGEST_QUEUE_NAME || 'csv-ingest';
export const MAX_ATTEMPTS = Number(process.env.INGEST_ATTEMPTS || 3);
export const BACKOFF_MS = Number(process.env.INGEST_BACKOFF_MS || 2000);

type Broadcast = (workspaceId: string, event: string, payload: unknown) => void;
let broadcast: Broadcast = () => {};

/** The API registers its Socket.io broadcaster here. */
export function setBroadcaster(fn: Broadcast): void {
  broadcast = fn;
}

export function queueEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

// BullMQ does not close connections it was handed, so keep track of them for shutdown.
const connections = new Set<IORedis>();
function connection(): IORedis {
  // BullMQ workers use blocking commands and need maxRetriesPerRequest: null.
  const conn = new IORedis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
  connections.add(conn);
  return conn;
}

let queue: Queue | null = null;
function getQueue(): Queue {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: connection() });
  return queue;
}

function emitProgress(slug: string, p: IngestProgress) {
  broadcast(slug, 'file:progress', p);
}

function emitDone(slug: string, r: IngestResult) {
  broadcast(slug, 'file:ready', {
    fileId: r.fileId,
    tableName: r.tableName,
    rowCount: r.rowCount,
    columnCount: r.columnCount,
    warnings: r.report.warnings.length,
  });
}

function emitFailed(slug: string, fileId: number, error: string) {
  broadcast(slug, 'file:failed', { fileId, error });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retries with exponential backoff in-process, mirroring the BullMQ job options.
async function runLocally(job: IngestJob): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await ingestFile(job, (p) => emitProgress(job.workspaceSlug, p));
      emitDone(job.workspaceSlug, result);
      return;
    } catch (err) {
      const message = (err as Error).message;
      if (attempt === MAX_ATTEMPTS || message === 'CSV file is empty') {
        await markFailed(job.fileId, message);
        emitFailed(job.workspaceSlug, job.fileId, message);
        return;
      }
      await sleep(BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
}

const localJobs = new Set<Promise<void>>();

/** Queue a file for ingestion. Returns the job id. */
export async function enqueueIngest(job: IngestJob): Promise<string> {
  if (!queueEnabled()) {
    const p = runLocally(job).finally(() => localJobs.delete(p));
    localJobs.add(p);
    return `local-${job.fileId}`;
  }
  const added = await getQueue().add('ingest', job, {
    attempts: MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
  return String(added.id);
}

/** Wait for in-process jobs (used by tests and graceful shutdown). */
export async function drainLocalJobs(): Promise<void> {
  while (localJobs.size) await Promise.all([...localJobs]);
}

/** Start a BullMQ worker. Used by worker.js and by the API when RUN_WORKER_IN_API=true. */
export function startWorker(concurrency = Number(process.env.INGEST_CONCURRENCY || 2)): Worker {
  const worker = new Worker<IngestJob, IngestResult>(
    QUEUE_NAME,
    async (job: Job<IngestJob>) => {
      try {
        // Progress is relayed to the browser by the API's QueueEvents listener.
        return await ingestFile(job.data, (p) =>
          job.updateProgress({ ...p, workspaceSlug: job.data.workspaceSlug })
        );
      } catch (err) {
        const message = (err as Error).message;
        const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        if (final) await markFailed(job.data.fileId, message);
        throw err;
      }
    },
    { connection: connection(), concurrency }
  );
  worker.on('failed', (job, err) => {
    console.error(`Ingest job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`);
  });
  return worker;
}

/** In the API process: forward BullMQ events to the right workspace room. */
export function relayQueueEvents(): QueueEvents | null {
  if (!queueEnabled()) return null;
  const events = new QueueEvents(QUEUE_NAME, { connection: connection() });
  events.on('progress', ({ data }) => {
    const p = data as IngestProgress & { workspaceSlug: string };
    if (p && p.workspaceSlug) emitProgress(p.workspaceSlug, p);
  });
  events.on('completed', async ({ jobId, returnvalue }) => {
    const job = await getQueue().getJob(jobId);
    if (job) emitDone(job.data.workspaceSlug, returnvalue as unknown as IngestResult);
  });
  events.on('failed', async ({ jobId, failedReason }) => {
    const job = await getQueue().getJob(jobId);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      emitFailed(job.data.workspaceSlug, job.data.fileId, failedReason);
    }
  });
  return events;
}

/** Close the queue and every Redis connection this module opened. Close workers first. */
export async function closeQueue(): Promise<void> {
  if (queue) await queue.close();
  queue = null;
  await Promise.all([...connections].map((c) => c.quit().catch(() => c.disconnect())));
  connections.clear();
}
