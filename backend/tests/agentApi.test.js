// /api/agent endpoints with the LLM replaced by a scripted model.
const { ScriptedChatModel, toolCall, text } = require('./helpers/scriptedModel');

let script = [];
jest.mock('../agent/llm', () => ({
  createChatModel: () => ({ model: new ScriptedChatModel(script), name: 'scripted' }),
}));

const { registerUser } = require('./helpers/api');

let user;
let other;
beforeAll(async () => {
  user = await registerUser('agent-api');
  other = await registerUser('agent-api-other');
  await user.upload('sales.csv', 'region,amount\nnorth,10\nsouth,20\nnorth,5\n');
});

it('validates the question', async () => {
  expect((await user.post('/api/agent/ask').send({})).status).toBe(400);
  expect((await user.post('/api/agent/ask').send({ question: 'x', mode: 'magic' })).status).toBe(
    400
  );
});

it('answers a question and shows the SQL', async () => {
  script = [
    toolCall('get_schema', { tables: ['sales'] }),
    toolCall('run_readonly_query', {
      sql: 'SELECT region, sum(amount) AS total FROM sales GROUP BY region ORDER BY region',
    }),
    text('North sold 15 and south 20.'),
  ];
  const res = await user
    .post('/api/agent/ask')
    .send({ question: 'Total by region?', requestId: 'r1' });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    status: 'answered',
    answer: 'North sold 15 and south 20.',
    sql: 'SELECT region, sum(amount) AS total FROM sales GROUP BY region ORDER BY region',
    rows: [
      { region: 'north', total: '15' },
      { region: 'south', total: '20' },
    ],
  });
  expect(res.body.runId).toBeTruthy();

  const runs = await user.get('/api/agent/runs');
  expect(runs.body.runs[0]).toMatchObject({
    id: res.body.runId,
    status: 'answered',
    question: 'Total by region?',
  });
  const detail = await user.get(`/api/agent/runs/${res.body.runId}`);
  expect(detail.body.steps.map((s) => s.step_type)).toContain('run_sql');

  // Run history is private to the workspace.
  expect((await other.get(`/api/agent/runs/${res.body.runId}`)).status).toBe(404);
  expect((await other.get('/api/agent/runs')).body.runs).toHaveLength(0);
});

it('supports the single-shot baseline mode', async () => {
  script = [text('SELECT count(*) AS n FROM sales')];
  const res = await user
    .post('/api/agent/ask')
    .send({ question: 'How many rows?', mode: 'single_shot' });
  expect(res.status).toBe(200);
  expect(res.body.rows).toEqual([{ n: '3' }]);
});

describe('asking about selected tables and documents', () => {
  let sales;
  let costs;
  beforeAll(async () => {
    const files = (await user.get('/api/files')).body.files;
    sales = files.find((f) => f.table_name === 'sales');
    costs = (await user.upload('costs.csv', 'region,cost\nnorth,3\n')).body.file;
  });

  it('only shows the model the selected tables', async () => {
    script = [
      toolCall('get_schema', { tables: ['sales', 'costs'] }),
      toolCall('run_readonly_query', { sql: 'SELECT count(*) AS n FROM sales' }),
      text('3 rows.'),
    ];
    const res = await user
      .post('/api/agent/ask')
      .send({ question: 'How many sales rows?', fileIds: [sales.id], documentIds: [] });
    expect(res.status).toBe(200);
    const detail = await user.get(`/api/agent/runs/${res.body.runId}`);
    const schemaStep = detail.body.steps.find((s) => s.step_type === 'get_schema');
    const schemaText = JSON.stringify(schemaStep.tool_output);
    expect(schemaText).toContain('sales');
    expect(schemaText).not.toContain('costs');
  });

  it('rejects an empty selection and ids from other workspaces', async () => {
    const empty = await user
      .post('/api/agent/ask')
      .send({ question: 'Anything?', fileIds: [], documentIds: [] });
    expect(empty.status).toBe(400);
    const foreign = await other
      .post('/api/agent/ask')
      .send({ question: 'Anything?', fileIds: [costs.id], documentIds: [] });
    expect(foreign.status).toBe(400);
    const bad = await user.post('/api/agent/ask').send({ question: 'x', fileIds: ['abc'] });
    expect(bad.status).toBe(400);
  });
});

it('returns 502 when the model fails', async () => {
  script = [];
  const res = await user.post('/api/agent/ask').send({ question: 'Anything?' });
  expect(res.status).toBe(502);
});
