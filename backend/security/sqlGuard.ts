// Static checks on SQL written by users or by the agent, before it reaches the database.
//
// Layer 1 parses the text with libpg-query (PostgreSQL's own parser compiled to WASM) and walks
// the syntax tree. Layer 2 is the original keyword denylist, applied to real keyword tokens from
// the scanner so that string literals and comments do not trigger it.
//
// These checks are not the main defence. The query still runs as a read-only role that can only
// see one workspace schema (see services/readonlyQuery.ts). The parser exists to give clear,
// early errors and to block a few things the role cannot, such as switching roles with set_config.
import { loadModule, parseSync, scanSync } from 'libpg-query';

export type GuardErrorCode =
  | 'EMPTY_QUERY'
  | 'SYNTAX_ERROR'
  | 'MULTIPLE_STATEMENTS'
  | 'NOT_SELECT'
  | 'FORBIDDEN_CLAUSE'
  | 'FORBIDDEN_RELATION'
  | 'FORBIDDEN_FUNCTION'
  | 'FORBIDDEN_KEYWORD';

export type GuardResult =
  { ok: true; sql: string } | { ok: false; code: GuardErrorCode; message: string };

// Second layer, carried over from the original sqlService denylist.
const DENIED_KEYWORDS = new Set([
  'DROP',
  'DELETE',
  'ALTER',
  'TRUNCATE',
  'INSERT',
  'UPDATE',
  'MERGE',
  'CREATE',
  'GRANT',
  'REVOKE',
  'COPY',
]);

// Functions that change session state, touch the server, or run dynamic SQL.
const DENIED_FUNCTIONS = new Set([
  'set_config',
  'query_to_xml',
  'query_to_xml_and_xmlschema',
  'query_to_xmlschema',
  'cursor_to_xml',
  'cursor_to_xmlschema',
  'database_to_xml',
  'schema_to_xml',
  'table_to_xml',
  'current_setting',
  'txid_current',
  'pg_current_xact_id',
]);
const DENIED_FUNCTION_PATTERNS = [
  /^pg_(try_)?advisory/,
  /^pg_(read|ls|stat_file)/,
  /^pg_(terminate|cancel)_backend$/,
  /^pg_(reload_conf|rotate_logfile|promote|switch_wal|notify|logical_)/,
  /^(lo_|dblink)/,
];
const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'pg_toast']);

let loaded: Promise<void> | null = null;

export function initSqlGuard(): Promise<void> {
  if (!loaded) loaded = loadModule();
  return loaded;
}

function fail(code: GuardErrorCode, message: string): GuardResult {
  return { ok: false, code, message };
}

type Node = Record<string, unknown>;

// Depth-first walk over the JSON AST, calling visit(nodeType, node) for every typed node.
function walk(value: unknown, visit: (type: string, node: Node) => string | null): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const err = walk(item, visit);
      if (err) return err;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Node)) {
      if (/^[A-Z]/.test(key) && child && typeof child === 'object' && !Array.isArray(child)) {
        const err = visit(key, child as Node);
        if (err) return err;
      }
      const err = walk(child, visit);
      if (err) return err;
    }
  }
  return null;
}

function stringList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => (item as { String?: { sval?: string } }).String?.sval ?? '');
}

/**
 * Check that `sql` is exactly one SELECT that only reads from `schema`.
 * On success returns the statement text without a trailing semicolon, ready to be wrapped.
 */
export async function checkSql(sql: string, opts: { schema: string }): Promise<GuardResult> {
  await initSqlGuard();
  if (typeof sql !== 'string' || !sql.trim()) return fail('EMPTY_QUERY', 'Query is empty');

  let tree: { stmts?: Array<{ stmt: Node; stmt_location?: number; stmt_len?: number }> };
  try {
    tree = parseSync(sql) as unknown as typeof tree;
  } catch (err) {
    return fail('SYNTAX_ERROR', `SQL syntax error: ${(err as Error).message}`);
  }

  const stmts = tree.stmts ?? [];
  if (stmts.length === 0) return fail('EMPTY_QUERY', 'Query is empty');
  if (stmts.length > 1) {
    return fail('MULTIPLE_STATEMENTS', 'Only one SQL statement can be run at a time');
  }

  const { stmt, stmt_location = 0, stmt_len = 0 } = stmts[0];
  const [topType] = Object.keys(stmt);
  if (topType !== 'SelectStmt') {
    return fail('NOT_SELECT', 'Only SELECT queries are allowed');
  }

  const allowedSchema = opts.schema.toLowerCase();
  const err = walk(stmt, (type, node) => {
    if (type.endsWith('Stmt') && type !== 'SelectStmt') {
      return `NOT_SELECT:Statements of type ${type.replace(/Stmt$/, '')} are not allowed`;
    }
    if (type === 'SelectStmt') {
      if (node.intoClause) return 'FORBIDDEN_CLAUSE:SELECT INTO is not allowed';
      if (node.lockingClause)
        return 'FORBIDDEN_CLAUSE:Row locking clauses (FOR UPDATE/SHARE) are not allowed';
    }
    if (type === 'RangeVar') {
      const schemaname = (node.schemaname as string | undefined)?.toLowerCase();
      const relname = String(node.relname ?? '').toLowerCase();
      if (node.catalogname) return 'FORBIDDEN_RELATION:Cross-database references are not allowed';
      if (schemaname && SYSTEM_SCHEMAS.has(schemaname)) {
        return `FORBIDDEN_RELATION:System catalog "${schemaname}" cannot be queried`;
      }
      if (schemaname && schemaname !== allowedSchema) {
        return `FORBIDDEN_RELATION:Only tables in this workspace can be queried (got "${schemaname}.${relname}")`;
      }
      if (relname.startsWith('pg_')) {
        return `FORBIDDEN_RELATION:System catalog "${relname}" cannot be queried`;
      }
    }
    if (type === 'FuncCall') {
      const parts = stringList(node.funcname).map((p) => p.toLowerCase());
      const name = parts[parts.length - 1];
      if (parts.length > 1 && !['pg_catalog', 'public'].includes(parts[0])) {
        return `FORBIDDEN_FUNCTION:Function "${parts.join('.')}" is not allowed`;
      }
      if (DENIED_FUNCTIONS.has(name) || DENIED_FUNCTION_PATTERNS.some((re) => re.test(name))) {
        return `FORBIDDEN_FUNCTION:Function "${name}" is not allowed`;
      }
    }
    return null;
  });
  if (err) {
    const idx = err.indexOf(':');
    return fail(err.slice(0, idx) as GuardErrorCode, err.slice(idx + 1));
  }

  // Layer 2: keyword denylist on scanner tokens (ignores literals, quoted identifiers, comments).
  const { tokens } = scanSync(sql) as {
    tokens: Array<{ text: string; keywordKind: number }>;
  };
  for (const token of tokens) {
    const word = token.text.toUpperCase();
    if (token.keywordKind > 0 && DENIED_KEYWORDS.has(word)) {
      return fail('FORBIDDEN_KEYWORD', `Query contains a forbidden keyword: ${word}`);
    }
  }

  const statement = (
    stmt_len ? sql.slice(stmt_location, stmt_location + stmt_len) : sql.slice(stmt_location)
  )
    .trim()
    .replace(/;+\s*$/, '');
  return { ok: true, sql: statement };
}
