// Phase 1 rejection tests, run against a real PostgreSQL database through the HTTP API.
const pool = require('../config/database');
const { registerUser } = require('./helpers/api');
const { getReaderPool } = require('../services/readonlyQuery');
const { getWorkspace } = require('../services/workspaceService');

const CSV = 'name,dept,salary\nann,eng,100\nbob,ops,0\ncy,eng,250\n';

let alice;
let mallory;
let aliceTable;

beforeAll(async () => {
  alice = await registerUser('sec-team');
  mallory = await registerUser('sec-other');
  const res = await alice.upload('employees.csv', CSV);
  expect(res.status).toBe(201);
  aliceTable = res.body.file.tableName;
});

const expectRejected = async (agent, query, code) => {
  const res = await agent.query(query);
  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
  if (code) expect(res.body.code).toBe(code);
  return res;
};

describe('allowed queries', () => {
  it('runs a SELECT on the workspace table by its short name', async () => {
    const res = await alice.query(`SELECT name, salary FROM ${aliceTable} ORDER BY name`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { name: 'ann', salary: 100 },
      { name: 'bob', salary: 0 },
      { name: 'cy', salary: 250 },
    ]);
  });
});

describe('statement types are rejected', () => {
  it.each([
    ['DROP', 'DROP TABLE employees'],
    ['DELETE', 'DELETE FROM employees'],
    ['UPDATE', 'UPDATE employees SET salary = 1'],
    ['INSERT', "INSERT INTO employees (name) VALUES ('x')"],
    ['ALTER', 'ALTER TABLE employees DROP COLUMN salary'],
  ])('%s', async (_label, sql) => {
    await expectRejected(alice, sql, 'NOT_SELECT');
  });

  it('multi-statement input', async () => {
    await expectRejected(
      alice,
      'SELECT 1; UPDATE employees SET salary = 999',
      'MULTIPLE_STATEMENTS'
    );
  });

  it('leaves the data unchanged after all the attempts', async () => {
    const res = await alice.query('SELECT sum(salary) AS total, count(*) AS n FROM employees');
    expect(res.body.data[0]).toEqual({ total: '350', n: '3' });
  });
});

describe('workspace isolation', () => {
  it("cannot name another workspace's schema", async () => {
    const ws = await getWorkspace('sec-team');
    await expectRejected(
      mallory,
      `SELECT * FROM ${ws.schemaName}.${aliceTable}`,
      'FORBIDDEN_RELATION'
    );
  });

  it("cannot see another workspace's table by its short name", async () => {
    const res = await expectRejected(mallory, `SELECT * FROM ${aliceTable}`, 'DB_ERROR');
    expect(res.body.error).toMatch(/does not exist/);
  });

  it('cannot read the users table', async () => {
    await expectRejected(mallory, 'SELECT * FROM users', 'DB_ERROR');
    await expectRejected(mallory, 'SELECT password_hash FROM public.users', 'FORBIDDEN_RELATION');
  });

  it('cannot read chat messages or file metadata', async () => {
    await expectRejected(mallory, 'SELECT * FROM chat_messages', 'DB_ERROR');
    await expectRejected(mallory, 'SELECT * FROM csv_files', 'DB_ERROR');
  });

  it("cannot open another workspace's file by id", async () => {
    const files = await alice.get('/api/files');
    const id = files.body.files[0].id;
    expect((await mallory.get(`/api/files/${id}`)).status).toBe(404);
    expect((await mallory.delete(`/api/files/${id}`)).status).toBe(404);
    expect((await alice.get(`/api/files/${id}`)).status).toBe(200);
  });
});

describe('timeouts and row caps', () => {
  it('stops long-running queries', async () => {
    const res = await expectRejected(alice, 'SELECT pg_sleep(10)', 'TIMEOUT');
    expect(res.body.executionTime).toBeLessThan(5000);
  });

  it('configures the reader role with a 5 s timeout and read-only default', async () => {
    const { rows } = await pool.query(
      "SELECT rolconfig, rolinherit FROM pg_roles WHERE rolname = 'datacollab_test_reader'"
    );
    expect(rows[0].rolconfig).toEqual(
      expect.arrayContaining(['statement_timeout=5s', 'default_transaction_read_only=on'])
    );
    expect(rows[0].rolinherit).toBe(false);
  });

  it('caps rows per page and reports hasMore', async () => {
    const page1 = await alice.query('SELECT g FROM generate_series(1, 2500) g', { pageSize: 5000 });
    expect(page1.body.rowCount).toBe(1000);
    expect(page1.body.hasMore).toBe(true);
    const page3 = await alice.query('SELECT g FROM generate_series(1, 2500) g ORDER BY g', {
      page: 3,
      pageSize: 1000,
    });
    expect(page3.body.rowCount).toBe(500);
    expect(page3.body.hasMore).toBe(false);
    expect(page3.body.data[0]).toEqual({ g: 2001 });
  });
});

describe('the database role is a second line of defence', () => {
  // These bypass the parser and talk to the reader pool directly, to show the role alone
  // still blocks writes and access to application tables.
  const asWorkspaceRole = async (sql) => {
    const ws = await getWorkspace('sec-team');
    const client = await getReaderPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE "${ws.roleName}"`);
      await client.query(`SET LOCAL search_path TO "${ws.schemaName}"`);
      return await client.query(sql);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };

  it('cannot write even without the parser', async () => {
    await expect(asWorkspaceRole(`DELETE FROM ${aliceTable}`)).rejects.toMatchObject({
      code: '25006',
    });
  });

  it('cannot read users even without the parser', async () => {
    await expect(asWorkspaceRole('SELECT * FROM public.users')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('has no table privileges before SET ROLE', async () => {
    const ws = await getWorkspace('sec-team');
    await expect(
      getReaderPool().query(`SELECT * FROM "${ws.schemaName}"."${aliceTable}"`)
    ).rejects.toMatchObject({ code: '42501' });
  });
});
