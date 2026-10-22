// Execution-based scoring: run the reference SQL and the predicted SQL, then compare results.
//
// - Column names do not matter, and extra predicted columns are allowed: every reference column
//   must match some distinct predicted column (found by trying column mappings).
// - Row order is ignored unless the question asks for an order (`ordered: true`).
// - Numbers match within a small tolerance (|a-b| <= 0.005 or relative 1e-4), so rounding a
//   result to two decimals still counts. Numeric strings from PostgreSQL are compared as numbers.
// - A timestamp at UTC midnight equals the same date ('2024-04-03').

export type Cell = string | number | boolean | null;
export interface ResultSet {
  columns: string[];
  rows: Record<string, unknown>[];
}

const NUMERIC_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const MIDNIGHT_RE = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.000)?(Z|\+00:00)$/;

export function normalize(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const iso = value.toISOString();
    const m = iso.match(MIDNIGHT_RE);
    return m ? m[1] : iso;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  const s = String(value).trim();
  if (NUMERIC_RE.test(s)) return Number(s);
  const m = s.match(MIDNIGHT_RE);
  if (m) return m[1];
  return typeof value === 'object' ? JSON.stringify(value) : s;
}

export function cellsEqual(a: Cell, b: Cell): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    const diff = Math.abs(a - b);
    return diff <= 0.005 + 1e-9 || diff <= 1e-4 * Math.max(Math.abs(a), Math.abs(b));
  }
  return a === b;
}

// Total order for sorting before an unordered comparison: nulls, then numbers by exact value,
// then strings. (Sorting numbers by a rounded key let values that round alike, such as 4.665 and
// 4.670045, land in different orders in the two results and then be compared with each other.)
function compareCells(a: Cell, b: Cell): number {
  const rank = (c: Cell) => (c === null ? 0 : typeof c === 'number' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === null || b === null) return 0;
  return String(a).localeCompare(String(b));
}

function compareTuples(a: Cell[], b: Cell[]): number {
  for (let i = 0; i < a.length; i++) {
    const c = compareCells(a[i], b[i]);
    if (c !== 0) return c;
  }
  return 0;
}

function columnVector(rows: Record<string, unknown>[], col: string): Cell[] {
  return rows.map((r) => normalize(r[col]));
}

function vectorsMatch(a: Cell[], b: Cell[], ordered: boolean): boolean {
  if (a.length !== b.length) return false;
  const x = ordered ? a : [...a].sort(compareCells);
  const y = ordered ? b : [...b].sort(compareCells);
  return x.every((v, i) => cellsEqual(v, y[i]));
}

function tuplesMatch(ref: Cell[][], pred: Cell[][], ordered: boolean): boolean {
  if (ref.length !== pred.length) return false;
  const x = ordered ? ref : [...ref].sort(compareTuples);
  const y = ordered ? pred : [...pred].sort(compareTuples);
  return x.every((row, i) => row.every((v, j) => cellsEqual(v, y[i][j])));
}

export function resultsMatch(ref: ResultSet, pred: ResultSet, ordered = false): boolean {
  if (ref.rows.length !== pred.rows.length) return false;
  if (ref.rows.length === 0) return true;
  if (pred.columns.length < ref.columns.length) return false;

  const refCols = ref.columns.map((c) => columnVector(ref.rows, c));
  const predCols = pred.columns.map((c) => columnVector(pred.rows, c));
  const candidates = refCols.map((rc) =>
    predCols.map((pc, j) => (vectorsMatch(rc, pc, ordered) ? j : -1)).filter((j) => j >= 0)
  );
  if (candidates.some((c) => c.length === 0)) return false;

  const refTuples = ref.rows.map((_, i) => refCols.map((col) => col[i]));
  const assignment: number[] = [];
  const used = new Set<number>();
  const search = (i: number): boolean => {
    if (i === refCols.length) {
      const predTuples = pred.rows.map((_, r) => assignment.map((j) => predCols[j][r]));
      return tuplesMatch(refTuples, predTuples, ordered);
    }
    for (const j of candidates[i]) {
      if (used.has(j)) continue;
      used.add(j);
      assignment[i] = j;
      if (search(i + 1)) return true;
      used.delete(j);
    }
    return false;
  };
  return search(0);
}
