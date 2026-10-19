// Two API instances sharing Redis: an event emitted by one reaches a socket on the other.
const { io: connect } = require('socket.io-client');
const jwt = require('jsonwebtoken');

const REDIS = process.env.TEST_REDIS_URL || 'redis://localhost:6379';

it('broadcasts workspace events across replicas through the Redis adapter', async () => {
  const saved = { REDIS_URL: process.env.REDIS_URL, NODE_ENV: process.env.NODE_ENV };
  process.env.REDIS_URL = REDIS;
  process.env.NODE_ENV = 'development';
  const { createApp } = require('../app');
  const a = createApp();
  const b = createApp();
  process.env.REDIS_URL = saved.REDIS_URL;
  process.env.NODE_ENV = saved.NODE_ENV;

  await new Promise((r) => a.server.listen(0, r));
  await new Promise((r) => b.server.listen(0, r));
  const token = jwt.sign(
    { userId: 1, username: 'x', workspaceId: 'adapter-ws' },
    process.env.JWT_SECRET
  );
  const client = connect(`http://127.0.0.1:${b.server.address().port}`, {
    auth: { token },
    transports: ['websocket'],
  });
  await new Promise((r) => client.on('connect', r));
  // Give the adapter subscription a moment to settle.
  await new Promise((r) => setTimeout(r, 300));

  const received = new Promise((r) => client.on('chat:message', r));
  a.app.get('broadcast')('adapter-ws', 'chat:message', { message: 'from replica A' });
  await expect(received).resolves.toEqual({ message: 'from replica A' });

  client.close();
  for (const inst of [a, b]) {
    await new Promise((r) => inst.io.close(r));
    const adapter = inst.io.of('/').adapter;
    if (adapter.pubClient) await adapter.pubClient.quit();
    if (adapter.subClient) await adapter.subClient.quit();
  }
});
