import { checkSql } from '../security/sqlGuard';

const schema = 'ws_1';
const expectCode = async (sql: string, code: string) => {
  const result = await checkSql(sql, { schema });
  expect(result).toMatchObject({ ok: false, code });
};

describe('sqlGuard: allowed queries', () => {
  it.each([
    'SELECT * FROM employees',
    'select name, count(*) from employees group by name order by 2 desc',
    'WITH t AS (SELECT 1 AS x) SELECT x FROM t',
    'SELECT * FROM ws_1.employees',
    "SELECT * FROM t WHERE status = 'deleted' -- update later",
    'SELECT "delete" FROM t',
    'SELECT a.x FROM a JOIN b ON a.id = b.id UNION SELECT 1',
    'SELECT now()::date, pg_catalog.lower(name) FROM t',
  ])('accepts %s', async (sql) => {
    const result = await checkSql(sql, { schema });
    expect(result.ok).toBe(true);
  });

  it('strips a trailing semicolon and comments outside the statement', async () => {
    const result = await checkSql('  SELECT 1 ;  ', { schema });
    expect(result).toEqual({ ok: true, sql: 'SELECT 1' });
  });
});

describe('sqlGuard: rejected queries', () => {
  it('rejects empty input', () => expectCode('   ', 'EMPTY_QUERY'));
  it('rejects only a comment', () => expectCode('-- nothing', 'EMPTY_QUERY'));
  it('rejects syntax errors', () => expectCode('SELEC * FROM t', 'SYNTAX_ERROR'));
  it('rejects DROP', () => expectCode('DROP TABLE employees', 'NOT_SELECT'));
  it('rejects DELETE', () => expectCode('DELETE FROM employees', 'NOT_SELECT'));
  it('rejects UPDATE', () => expectCode('UPDATE employees SET salary = 0', 'NOT_SELECT'));
  it('rejects INSERT', () => expectCode('INSERT INTO employees VALUES (1)', 'NOT_SELECT'));
  it('rejects ALTER', () => expectCode('ALTER TABLE employees ADD c int', 'NOT_SELECT'));
  it('rejects TRUNCATE', () => expectCode('TRUNCATE employees', 'NOT_SELECT'));
  it('rejects SET ROLE', () => expectCode('SET ROLE postgres', 'NOT_SELECT'));
  it('rejects multiple statements', () =>
    expectCode('SELECT 1; DELETE FROM employees', 'MULTIPLE_STATEMENTS'));
  it('rejects two SELECTs', () => expectCode('SELECT 1; SELECT 2', 'MULTIPLE_STATEMENTS'));
  it('rejects data-modifying CTEs', () =>
    expectCode('WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', 'NOT_SELECT'));
  it('rejects SELECT INTO', () => expectCode('SELECT * INTO copy FROM t', 'FORBIDDEN_CLAUSE'));
  it('rejects FOR UPDATE', () => expectCode('SELECT * FROM t FOR UPDATE', 'FORBIDDEN_CLAUSE'));
  it('rejects other workspace schemas', () =>
    expectCode('SELECT * FROM ws_2.employees', 'FORBIDDEN_RELATION'));
  it('rejects public.users', () => expectCode('SELECT * FROM public.users', 'FORBIDDEN_RELATION'));
  it('rejects subqueries into other schemas', () =>
    expectCode('SELECT (SELECT count(*) FROM public.users) FROM t', 'FORBIDDEN_RELATION'));
  it('rejects pg_catalog tables', () => expectCode('SELECT * FROM pg_roles', 'FORBIDDEN_RELATION'));
  it('rejects information_schema', () =>
    expectCode('SELECT * FROM information_schema.tables', 'FORBIDDEN_RELATION'));
  it('rejects cross-database names', () =>
    expectCode('SELECT * FROM otherdb.ws_1.t', 'FORBIDDEN_RELATION'));
  it('rejects set_config role switching', () =>
    expectCode("SELECT set_config('role', 'x', true)", 'FORBIDDEN_FUNCTION'));
  it('rejects dynamic SQL through query_to_xml', () =>
    expectCode(
      "SELECT query_to_xml('select * from public.users', true, true, '')",
      'FORBIDDEN_FUNCTION'
    ));
  it('rejects advisory locks', () =>
    expectCode('SELECT pg_advisory_lock(1)', 'FORBIDDEN_FUNCTION'));
  it('rejects server file reads', () =>
    expectCode("SELECT pg_read_file('/etc/passwd')", 'FORBIDDEN_FUNCTION'));
  it('rejects functions in other schemas', () =>
    expectCode('SELECT ws_2.f()', 'FORBIDDEN_FUNCTION'));
});
