// Joining a workspace requires its invite code; creating one does not.
const request = require('supertest');
const { app, registerUser } = require('./helpers/api');

let n = 0;
const newUser = (extra) => {
  n += 1;
  const name = `inv${Date.now().toString(36)}${n}`;
  return request(app)
    .post('/api/auth/register')
    .send({ username: name, email: `${name}@test.dev`, password: 'secret123', ...extra });
};

const slug = `invite-${Date.now().toString(36)}`;

it('gives the creator of a new workspace its invite code', async () => {
  const res = await newUser({ workspaceId: slug });
  expect(res.status).toBe(201);
  expect(res.body.user.workspaceId).toBe(slug);
  expect(res.body.inviteCode).toMatch(/^[A-Za-z0-9_-]{12}$/);
});

it('refuses to join an existing workspace without the right code', async () => {
  const none = await newUser({ workspaceId: slug });
  expect(none.status).toBe(403);
  expect(none.body.code).toBe('INVITE_REQUIRED');
  const wrong = await newUser({ workspaceId: slug, inviteCode: 'not-the-code' });
  expect(wrong.status).toBe(403);
});

it('joins with the code, which members can see and replace', async () => {
  const owner = await registerUser(slug);
  const ws = await owner.get('/api/workspace');
  expect(ws.status).toBe(200);
  const code = ws.body.workspace.inviteCode;
  expect(ws.body.workspace.members.length).toBeGreaterThanOrEqual(2);

  const joined = await newUser({ workspaceId: slug, inviteCode: ` ${code} ` });
  expect(joined.status).toBe(201);
  expect(joined.body.inviteCode).toBeUndefined();

  const rotated = await owner.post('/api/workspace/invite-code');
  expect(rotated.body.inviteCode).not.toBe(code);
  expect((await newUser({ workspaceId: slug, inviteCode: code })).status).toBe(403);
  expect((await newUser({ workspaceId: slug, inviteCode: rotated.body.inviteCode })).status).toBe(
    201
  );
});

it('creates a private workspace when none is given', async () => {
  const a = await newUser({});
  const b = await newUser({});
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(a.body.user.workspaceId).not.toBe(b.body.user.workspaceId);
  expect(a.body.inviteCode).toBeTruthy();
});

it("does not show another workspace's code", async () => {
  const other = await registerUser(`${slug}-other`);
  const mine = await registerUser(slug);
  const a = (await other.get('/api/workspace')).body.workspace;
  const b = (await mine.get('/api/workspace')).body.workspace;
  expect(a.slug).not.toBe(b.slug);
  expect(a.inviteCode).not.toBe(b.inviteCode);
  expect(a.members.every((m) => !b.members.some((x) => x.id === m.id))).toBe(true);
});
