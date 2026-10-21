const request = require('supertest');

it('accepts FRONTEND_URL with a trailing slash or spaces', async () => {
  const saved = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = ' https://data-collab.vercel.app/ ';
  const { app } = require('../app').createApp();
  process.env.FRONTEND_URL = saved;
  const res = await request(app)
    .options('/api/auth/login')
    .set('Origin', 'https://data-collab.vercel.app')
    .set('Access-Control-Request-Method', 'POST');
  expect(res.headers['access-control-allow-origin']).toBe('https://data-collab.vercel.app');
  const other = await request(app)
    .options('/api/auth/login')
    .set('Origin', 'https://evil.example')
    .set('Access-Control-Request-Method', 'POST');
  expect(other.headers['access-control-allow-origin']).toBeUndefined();
});
