// Agent tools and graph, with a scripted LLM against a real PostgreSQL workspace.
import { summarizePrompt } from '../agent/prompts';
import { ensureWorkspace, type Workspace } from '../services/workspaceService';
import { makeTools } from '../agent/tools';
import {
  runAgent,
  runSingleShot,
  extractToolArgs,
  extractSqlFromText,
  type AgentStep,
} from '../agent/graph';
import { ask } from '../agent/service';
import { ScriptedChatModel, toolCall, text } from './helpers/scriptedModel';
const { registerUser } = require('./helpers/api');
const pool = require('../config/database');

const CSV = 'name,dept,salary\nann,eng,100\nbob,ops,80\ncy,eng,250\n';
let workspace: Workspace;

beforeAll(async () => {
  const user = await registerUser('agent-team');
  const res = await user.upload('employees.csv', CSV);
  expect(res.status).toBe(201);
  workspace = await ensureWorkspace('agent-team');
});

describe('tools', () => {
  it('get_schema lists columns, types and samples', async () => {
    const { getSchema } = makeTools({ workspace, model: new ScriptedChatModel([]) });
    const out = String(await getSchema.invoke({}));
    expect(out).toContain('Table "employees" (3 rows');
    expect(out).toMatch(/"salary" INTEGER e\.g\. "100"/);
  });

  it('get_schema adds column profiles when asked', async () => {
    const { getSchema } = makeTools({
      workspace,
      model: new ScriptedChatModel([]),
      schemaOptions: { includeProfiles: true },
    });
    expect(String(await getSchema.invoke({}))).toContain('range 80 to 250');
  });

  it('run_readonly_query returns rows and timing', async () => {
    const { runQuery } = makeTools({ workspace, model: new ScriptedChatModel([]) });
    const out = await runQuery.invoke({
      sql: 'SELECT name FROM employees ORDER BY salary DESC LIMIT 1',
    });
    expect(out).toMatchObject({ ok: true, rowCount: 1, rows: [{ name: 'cy' }], columns: ['name'] });
  });

  it('run_readonly_query returns a structured error', async () => {
    const { runQuery } = makeTools({ workspace, model: new ScriptedChatModel([]) });
    const out = await runQuery.invoke({ sql: 'DELETE FROM employees' });
    expect(out).toMatchObject({ ok: false, code: 'NOT_SELECT' });
  });

  it('run_readonly_query rejects bad input through the zod schema', async () => {
    const { runQuery } = makeTools({ workspace, model: new ScriptedChatModel([]) });
    await expect(runQuery.invoke({ sql: 42 } as never)).rejects.toThrow();
  });

  it('summarize_result asks the model for a short answer', async () => {
    const model = new ScriptedChatModel([text('The top earner is cy with 250.')]);
    const { summarizeResult } = makeTools({ workspace, model });
    const out = await summarizeResult.invoke({
      question: 'Who earns most?',
      sql: 'SELECT ...',
      columns: ['name', 'salary'],
      rows: [{ name: 'cy', salary: 250 }],
      rowCount: 1,
    });
    expect(out).toMatchObject({ answer: 'The top earner is cy with 250.' });
    expect(String(model.calls[0][1].content)).toContain('"salary":250');
  });
});

describe('output parsing', () => {
  it('reads JSON tool calls written as text', () => {
    const args = extractToolArgs(
      text('{"name": "run_readonly_query", "arguments": {"sql": "SELECT 1"}}'),
      'x'
    );
    expect(args).toEqual({ sql: 'SELECT 1' });
  });

  it('finds SQL in code fences and prose', () => {
    expect(extractSqlFromText('Here:\n```sql\nSELECT a\nFROM t;\n```')).toBe('SELECT a\nFROM t');
    expect(extractSqlFromText('The query is SELECT 1;')).toBe('SELECT 1');
    expect(extractSqlFromText('no query here')).toBeNull();
  });
});

describe('agent graph', () => {
  it('retries after a broken query and answers with the second one', async () => {
    const model = new ScriptedChatModel([
      toolCall('get_schema', { tables: ['employees'] }),
      toolCall('run_readonly_query', {
        sql: 'SELECT dept, avg(salry) FROM employees GROUP BY dept',
      }),
      (messages) => {
        // The database error from the first attempt must be in the retry prompt.
        expect(String(messages[1].content)).toMatch(/column "salry" does not exist/);
        return toolCall('run_readonly_query', {
          sql: 'SELECT dept, round(avg(salary)) AS avg_salary FROM employees GROUP BY dept ORDER BY dept',
        });
      },
      text('Engineering averages 175 and operations 80.'),
    ]);
    const steps: AgentStep[] = [];
    const result = await runAgent('Average salary by department?', {
      workspace,
      model,
      onStep: (s) => {
        steps.push(s);
      },
    });

    expect(result.status).toBe('answered');
    expect(result.retries).toBe(1);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].code).toBe('DB_ERROR');
    expect(result.sql).toMatch(/avg\(salary\)/);
    expect(result.rows).toEqual([
      { dept: 'eng', avg_salary: '175' },
      { dept: 'ops', avg_salary: '80' },
    ]);
    expect(result.answer).toBe('Engineering averages 175 and operations 80.');
    expect(steps.map((s) => s.type)).toEqual([
      'plan',
      'get_schema',
      'write_sql',
      'run_sql',
      'check_result',
      'write_sql',
      'run_sql',
      'check_result',
      'answer',
    ]);
    expect(steps[5].message).toBe('Retrying (attempt 2)');
    expect(result.usage.inputTokens).toBe(30);
  });

  it('gives up after 3 retries', async () => {
    const broken = () => toolCall('run_readonly_query', { sql: 'SELECT nope FROM employees' });
    const model = new ScriptedChatModel([
      toolCall('get_schema', {}),
      broken(),
      broken(),
      broken(),
      broken(),
    ]);
    const result = await runAgent('Anything?', { workspace, model });
    expect(result.status).toBe('gave_up');
    expect(result.attempts).toHaveLength(4);
    expect(result.retries).toBe(3);
    expect(result.answer).toMatch(/after 4 attempt/);
  });

  it('respects a custom retry cap', async () => {
    const broken = () => toolCall('run_readonly_query', { sql: 'SELECT nope FROM employees' });
    const model = new ScriptedChatModel([toolCall('get_schema', {}), broken(), broken()]);
    const result = await runAgent('Anything?', { workspace, model, maxRetries: 1 });
    expect(result.status).toBe('gave_up');
    expect(result.attempts).toHaveLength(2);
  });

  it('double-checks an empty result and accepts it when the model repeats the query', async () => {
    const sql = "SELECT name FROM employees WHERE dept = 'sales'";
    const model = new ScriptedChatModel([
      toolCall('get_schema', {}),
      toolCall('run_readonly_query', { sql }),
      (messages) => {
        expect(String(messages[1].content)).toMatch(/returned no rows/);
        return toolCall('run_readonly_query', { sql });
      },
    ]);
    const result = await runAgent('Who works in sales?', { workspace, model });
    expect(result.status).toBe('answered');
    expect(result.attempts).toHaveLength(2);
    expect(result.answer).toBe('No matching rows were found.');
  });

  it('treats a reply without SQL as a failed attempt', async () => {
    const model = new ScriptedChatModel([
      toolCall('get_schema', {}),
      text('I am not sure.'),
      toolCall('run_readonly_query', { sql: 'SELECT count(*) AS n FROM employees' }),
      text('There are 3 employees.'),
    ]);
    const result = await runAgent('How many employees?', { workspace, model });
    expect(result.status).toBe('answered');
    expect(result.attempts[0].code).toBe('NO_SQL');
    expect(result.rows).toEqual([{ n: '3' }]);
  });

  it('ignores unknown tables chosen in the plan step', async () => {
    const model = new ScriptedChatModel([
      toolCall('get_schema', { tables: ['made_up'] }),
      (messages) => {
        expect(String(messages[1].content)).toContain('Table "employees"');
        return toolCall('run_readonly_query', { sql: 'SELECT 1 AS one' });
      },
      text('One.'),
    ]);
    const result = await runAgent('q', { workspace, model });
    expect(result.status).toBe('answered');
  });

  it('reports model failures as errors', async () => {
    const result = await runAgent('q', { workspace, model: new ScriptedChatModel([]) });
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/ran out of replies/);
  });
});

describe('single-shot baseline', () => {
  it('runs the SQL from one prompt without retrying', async () => {
    const model = new ScriptedChatModel([text('SELECT nope FROM employees')]);
    const result = await runSingleShot('q', { workspace, model });
    expect(result.status).toBe('error');
    expect(result.attempts).toHaveLength(1);
    expect(model.calls).toHaveLength(1);
  });
});

describe('tracing', () => {
  it('stores the run and each step', async () => {
    const model = new ScriptedChatModel([
      toolCall('get_schema', {}),
      toolCall('run_readonly_query', { sql: 'SELECT max(salary) AS top FROM employees' }),
      text('The highest salary is 250.'),
    ]);
    const result = await ask({
      workspace,
      question: 'Highest salary?',
      modelInfo: { model, name: 'scripted' },
      promptVariant: 'A',
    });
    const run = await pool.query('SELECT * FROM agent_runs WHERE id = $1', [result.runId]);
    expect(run.rows[0]).toMatchObject({
      status: 'answered',
      model: 'scripted',
      prompt_variant: 'A',
      attempts: 1,
      final_sql: 'SELECT max(salary) AS top FROM employees',
      answer: 'The highest salary is 250.',
    });
    expect(run.rows[0].latency_ms).toBeGreaterThanOrEqual(0);
    const steps = await pool.query(
      'SELECT * FROM agent_steps WHERE run_id = $1 ORDER BY step_index',
      [result.runId]
    );
    expect(steps.rows.map((s: { step_type: string }) => s.step_type)).toEqual([
      'plan',
      'get_schema',
      'write_sql',
      'run_sql',
      'check_result',
      'answer',
    ]);
    const write = steps.rows[2];
    expect(write.prompt).toContain('Highest salary?');
    expect(write.tool_input).toEqual({ sql: 'SELECT max(salary) AS top FROM employees' });
    expect(write.input_tokens).toBe(10);
  });
});

describe('summarizePrompt', () => {
  it('sends numeric strings from PostgreSQL as numbers', () => {
    const messages = summarizePrompt({
      question: 'Deaths?',
      sql: 'SELECT 1',
      columns: ['cause', 'deaths', 'code'],
      rows: [{ cause: 'Cancer', deaths: '599108', code: '007a' }],
      rowCount: 1,
    });
    const text = String(messages[1].content);
    expect(text).toContain('"deaths":599108');
    expect(text).toContain('"code":"007a"');
  });
});
