// MCP server: each tool through an in-memory client, the HTTP transport with token auth,
// and the stdio transport as a real subprocess.
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpServer } from '../mcp/server';
import { ensureWorkspace } from '../services/workspaceService';
const { createApp } = require('../app');
const { registerUser } = require('./helpers/api');

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
const textOf = (r: unknown) => (r as ToolResult).content[0].text;

let owner: Awaited<ReturnType<typeof registerUser>>;
let token: string;

beforeAll(async () => {
  owner = await registerUser('mcp-team');
  await owner.upload('sales.csv', 'region,amount\nnorth,10\nsouth,20\nnorth,5\n');
  await owner
    .post('/api/documents')
    .attach('file', Buffer.from('# Notes\n\nRegion north covers the northern stores.'), 'notes.md');
  const res = await owner.post('/api/tokens').send({ name: 'test client' });
  expect(res.status).toBe(201);
  token = res.body.token.token;
  expect(token).toMatch(/^dc_/);
});

describe('tools (in-memory transport)', () => {
  let client: Client;
  beforeAll(async () => {
    const workspace = await ensureWorkspace('mcp-team');
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(workspace).connect(serverSide);
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
  });
  afterAll(() => client.close());

  it('lists the four tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'describe_table',
      'list_tables',
      'run_readonly_query',
      'search_documents',
    ]);
  });

  it('list_tables', async () => {
    const out = JSON.parse(textOf(await client.callTool({ name: 'list_tables', arguments: {} })));
    expect(out.tables).toEqual([{ table: 'sales', rowCount: 3 }]);
  });

  it('describe_table', async () => {
    const r = await client.callTool({ name: 'describe_table', arguments: { table: 'sales' } });
    expect(textOf(r)).toContain('"amount" INTEGER');
    const missing = (await client.callTool({
      name: 'describe_table',
      arguments: { table: 'nope' },
    })) as ToolResult;
    expect(missing.isError).toBe(true);
  });

  it('run_readonly_query returns rows', async () => {
    const r = await client.callTool({
      name: 'run_readonly_query',
      arguments: {
        sql: 'SELECT region, sum(amount)::int AS total FROM sales GROUP BY region ORDER BY region',
      },
    });
    expect(JSON.parse(textOf(r)).rows).toEqual([
      { region: 'north', total: 15 },
      { region: 'south', total: 20 },
    ]);
  });

  it('run_readonly_query goes through the safety layer', async () => {
    const r = (await client.callTool({
      name: 'run_readonly_query',
      arguments: { sql: 'DELETE FROM sales' },
    })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^NOT_SELECT/);
    const users = (await client.callTool({
      name: 'run_readonly_query',
      arguments: { sql: 'SELECT * FROM public.users' },
    })) as ToolResult;
    expect(users.isError).toBe(true);
  });

  it('search_documents', async () => {
    const r = await client.callTool({
      name: 'search_documents',
      arguments: { query: 'northern stores' },
    });
    expect(JSON.parse(textOf(r))[0]).toMatchObject({ filename: 'notes.md', section: 'Notes' });
  });
});

describe('HTTP transport', () => {
  let server: import('http').Server;
  let url: URL;
  beforeAll(async () => {
    server = createApp().server;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = new URL(`http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}/mcp`);
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const connect = async (bearer: string) => {
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
      })
    );
    return client;
  };

  it('lists tables and runs a query with a valid token', async () => {
    const client = await connect(token);
    const tables = JSON.parse(
      textOf(await client.callTool({ name: 'list_tables', arguments: {} }))
    );
    expect(tables.workspace).toBe('mcp-team');
    const q = await client.callTool({
      name: 'run_readonly_query',
      arguments: { sql: 'SELECT count(*)::int AS n FROM sales' },
    });
    expect(JSON.parse(textOf(q)).rows).toEqual([{ n: 3 }]);
    await client.close();
  });

  it('rejects a missing or wrong token', async () => {
    await expect(connect('dc_not-a-real-token')).rejects.toThrow();
    const res = await fetch(url, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('scopes a token to its own workspace', async () => {
    const other = await registerUser('mcp-other');
    const otherToken = (await other.post('/api/tokens').send({ name: 'x' })).body.token.token;
    const client = await connect(otherToken);
    const tables = JSON.parse(
      textOf(await client.callTool({ name: 'list_tables', arguments: {} }))
    );
    expect(tables).toEqual({ workspace: 'mcp-other', tables: [] });
    const q = (await client.callTool({
      name: 'run_readonly_query',
      arguments: { sql: 'SELECT * FROM sales' },
    })) as ToolResult;
    expect(q.isError).toBe(true);
    await client.close();
  });

  it('stops working after the token is revoked', async () => {
    const created = (await owner.post('/api/tokens').send({ name: 'temporary' })).body.token;
    expect((await owner.delete(`/api/tokens/${created.id}`)).status).toBe(200);
    await expect(connect(created.token)).rejects.toThrow();
  });
});

describe('stdio transport', () => {
  it('serves tools to a client over stdin/stdout', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [require.resolve('tsx/cli'), path.join(__dirname, '..', 'mcp', 'stdio.ts')],
      env: {
        ...(process.env as Record<string, string>),
        NODE_OPTIONS: '',
        DATACOLLAB_TOKEN: token,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    await client.connect(transport);
    const tables = JSON.parse(
      textOf(await client.callTool({ name: 'list_tables', arguments: {} }))
    );
    expect(tables.tables[0].table).toBe('sales');
    await client.close();
  }, 30000);
});
