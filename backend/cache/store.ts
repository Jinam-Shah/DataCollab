// Key-value store for the query cache and rate limits: Redis when REDIS_URL is set (Upstash in
// production, Docker locally), otherwise an in-process store with the same behavior, so
// development and tests work without Redis. The in-process store is per API instance only.
import IORedis from 'ioredis';

export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Sliding-window log: record `now` for `key`, drop entries older than windowMs, return the count. */
  hit(
    key: string,
    nowMs: number,
    windowMs: number,
    member: string
  ): Promise<{ count: number; oldestMs: number }>;
  /** Remove the hit just recorded (used when a request is rejected). */
  unhit(key: string, member: string): Promise<void>;
  close(): Promise<void>;
}

class MemoryStore implements KvStore {
  private values = new Map<string, { value: string; expires: number }>();
  private windows = new Map<string, { at: number; member: string }[]>();

  async get(key: string) {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    this.values.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    if (this.values.size > 5000) this.values.delete(this.values.keys().next().value as string);
  }

  async hit(key: string, nowMs: number, windowMs: number, member: string) {
    const list = (this.windows.get(key) ?? []).filter((e) => e.at > nowMs - windowMs);
    list.push({ at: nowMs, member });
    this.windows.set(key, list);
    return { count: list.length, oldestMs: list[0].at };
  }

  async unhit(key: string, member: string) {
    this.windows.set(
      key,
      (this.windows.get(key) ?? []).filter((e) => e.member !== member)
    );
  }

  async close() {}
}

class RedisStore implements KvStore {
  constructor(private redis: IORedis) {}

  get(key: string) {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number) {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async hit(key: string, nowMs: number, windowMs: number, member: string) {
    // One round trip: trim the window, add this request, count, read the oldest, set expiry.
    const results = await this.redis
      .multi()
      .zremrangebyscore(key, 0, nowMs - windowMs)
      .zadd(key, nowMs, member)
      .zcard(key)
      .zrange(key, '0', '0', 'WITHSCORES')
      .pexpire(key, windowMs)
      .exec();
    const count = Number(results?.[2]?.[1] ?? 0);
    const oldest = (results?.[3]?.[1] as string[] | undefined)?.[1];
    return { count, oldestMs: oldest ? Number(oldest) : nowMs };
  }

  async unhit(key: string, member: string) {
    await this.redis.zrem(key, member);
  }

  async close() {
    await this.redis.quit();
  }
}

let store: KvStore | null = null;

export function getStore(): KvStore {
  if (!store) {
    store = process.env.REDIS_URL
      ? new RedisStore(
          new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000 })
        )
      : new MemoryStore();
  }
  return store;
}

export async function closeStore(): Promise<void> {
  if (store) await store.close();
  store = null;
}
