const request = require('supertest');
const { createApp } = require('../../app');

const { app } = createApp();

let counter = 0;
const pool = require('../../config/database');

// Invite code of an existing workspace, read from the database (tests join shared workspaces).
async function inviteCodeFor(workspaceId) {
  const { rows } = await pool.query('SELECT id FROM workspaces WHERE slug = $1', [workspaceId]);
  if (!rows[0]) return undefined;
  const { getInviteCode } = require('../../services/workspaceService');
  return getInviteCode(rows[0].id);
}

// Register a fresh user in `workspaceId` and return a supertest agent bound to its token.
// Joins with the workspace's invite code when it already has members.
async function registerUser(workspaceId) {
  counter += 1;
  const name =
    `u${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}${counter}${Math.random().toString(36).slice(2, 5)}`.slice(
      0,
      40
    );
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      username: name,
      email: `${name}@test.dev`,
      password: 'secret123',
      workspaceId,
      inviteCode: await inviteCodeFor(workspaceId),
    });
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const token = res.body.token;
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    token,
    user: res.body.user,
    get: (url) => auth(request(app).get(url)),
    post: (url) => auth(request(app).post(url)),
    delete: (url) => auth(request(app).delete(url)),
    query: (query, extra = {}) =>
      auth(request(app).post('/api/queries/execute')).send({ query, ...extra }),
    upload: (name, csvText) =>
      auth(request(app).post('/api/files/upload')).attach('file', Buffer.from(csvText), name),
  };
}

module.exports = { app, registerUser, inviteCodeFor };
