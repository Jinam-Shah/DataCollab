// Query cache and sliding-window rate limits, against the in-memory store and real Redis.
const express = require('express');
const request = require('supertest');
const { registerUser } = require('./helpers/api');
const { getStore, closeStore } = require('../cache/store');
const { rateLimit } = require('../middleware/rateLimit');

const REDIS = process.env.TEST_REDIS_URL || 'redis://localhost:6379';

describe('query cache', () => {
  let user;
  beforeAll(async () => {
    user = await registerUser(`cache-${Date.now().toString(36)}`);
    await user.upload('items.csv', 'name,qty\na,1\nb,2\n');
  });

  it('serves a repeated query from the cache', async () => {
    const sql = 'SELECT sum(qty)::int AS total FROM items';
    const first = await user.query(sql);
    expect(first.body).toMatchObject({ cached: false, data: [{ total: 3 }] });
    const second = await user.query(sql);
    expect(second.body).toMatchObject({ cached: true, data: [{ total: 3 }] });
  });

  it('keys on page and page size', async () => {
    const sql = 'SELECT name FROM items ORDER BY name';
    await user.query(sql, { page: 1, pageSize: 1 });
    const page2 = await user.query(sql, { page: 2, pageSize: 1 });
    expect(page2.body).toMatchObject({ cached: false, data: [{ name: 'b' }] });
  });

  it('never returns stale data after an upload changes the workspace', async () => {
    const sql = 'SELECT count(*)::int AS n FROM items';
    await user.query(sql);
    expect((await user.query(sql)).body.cached).toBe(true);
    // Any upload bumps the workspace data version.
    await user.upload('more.csv', 'x\n1\n');
    const after = await user.query(sql);
    expect(after.body.cached).toBe(false);
  });

  it('does not cache errors', async () => {
    await user.query('SELECT nope FROM items');
    const again = await user.query('SELECT nope FROM items');
    expect(again.status).toBe(400);
    expect(again.body.cached).toBeUndefined();
  });

  it('can be disabled with QUERY_CACHE_TTL_SECONDS=0', async () => {
    process.env.QUERY_CACHE_TTL_SECONDS = '0';
    try {
      const sql = 'SELECT 1 AS one FROM items LIMIT 1';
      await user.query(sql);
      expect((await user.query(sql)).body.cached).toBe(false);
    } finally {
      delete process.env.QUERY_CACHE_TTL_SECONDS;
    }
  });
});

function limitedApp(limit, windowMs) {
  const app = express();
  app.use((req, res, next) => {
    req.userId = Number(req.headers['x-user']);
    next();
  });
  app.get('/llm', rateLimit({ bucket: `t${Math.random()}`, limit, windowMs }), (req, res) =>
    res.json({ ok: true })
  );
  return app;
}

describe.each([
  ['in-memory', ''],
  ['redis', REDIS],
])('sliding-window rate limit (%s store)', (_name, url) => {
  beforeAll(async () => {
    await closeStore();
    process.env.REDIS_URL = url;
    getStore();
  });
  afterAll(async () => {
    await closeStore();
    process.env.REDIS_URL = '';
  });

  it('allows `limit` requests per window, then answers 429 with Retry-After', async () => {
    const app = limitedApp(3, 1000);
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get('/llm').set('x-user', '1');
      expect(ok.status).toBe(200);
      expect(ok.headers['ratelimit-remaining']).toBe(String(2 - i));
    }
    const limited = await request(app).get('/llm').set('x-user', '1');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(limited.body.error).toMatch(/at most 3 requests per 1 s/);
  });

  it('counts each user separately', async () => {
    const app = limitedApp(1, 1000);
    expect((await request(app).get('/llm').set('x-user', '1')).status).toBe(200);
    expect((await request(app).get('/llm').set('x-user', '2')).status).toBe(200);
    expect((await request(app).get('/llm').set('x-user', '1')).status).toBe(429);
  });

  it('frees capacity as the window slides', async () => {
    const app = limitedApp(2, 400);
    await request(app).get('/llm').set('x-user', '7');
    await request(app).get('/llm').set('x-user', '7');
    expect((await request(app).get('/llm').set('x-user', '7')).status).toBe(429);
    await new Promise((r) => setTimeout(r, 450));
    expect((await request(app).get('/llm').set('x-user', '7')).status).toBe(200);
  });
});

describe('rate limit on the agent endpoint', () => {
  it('returns 429 after the per-minute LLM limit', async () => {
    process.env.RATE_LIMIT_LLM_PER_MIN = '2';
    try {
      const u = await registerUser('rl-team');
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await u.post('/api/agent/ask').send({})).status);
      // Validation errors still count against the limit; the third request is limited.
      expect(statuses).toEqual([400, 400, 429]);
    } finally {
      delete process.env.RATE_LIMIT_LLM_PER_MIN;
    }
  });
});
