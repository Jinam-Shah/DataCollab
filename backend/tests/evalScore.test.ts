import { resultsMatch, normalize } from '../eval/score';

const rs = (columns: string[], rows: unknown[][]) => ({
  columns,
  rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))),
});

describe('eval scoring', () => {
  it('ignores column names and row order', () => {
    const ref = rs(
      ['region', 'sum'],
      [
        ['West', '10'],
        ['South', '20'],
      ]
    );
    const pred = rs(
      ['r', 'total'],
      [
        ['South', 20],
        ['West', 10],
      ]
    );
    expect(resultsMatch(ref, pred)).toBe(true);
  });

  it('respects row order when the question asks for it', () => {
    const ref = rs(['state'], [['A'], ['B']]);
    expect(resultsMatch(ref, rs(['state'], [['B'], ['A']]), true)).toBe(false);
    expect(resultsMatch(ref, rs(['state'], [['A'], ['B']]), true)).toBe(true);
  });

  it('allows extra predicted columns and any column order', () => {
    const ref = rs(['state'], [['Texas']]);
    expect(resultsMatch(ref, rs(['pop', 'state'], [[29, 'Texas']]))).toBe(true);
  });

  it('rejects missing columns and different row counts', () => {
    const ref = rs(['a', 'b'], [[1, 2]]);
    expect(resultsMatch(ref, rs(['a'], [[1]]))).toBe(false);
    expect(
      resultsMatch(
        ref,
        rs(
          ['a', 'b'],
          [
            [1, 2],
            [1, 2],
          ]
        )
      )
    ).toBe(false);
  });

  it('keeps rows together when matching columns', () => {
    const ref = rs(
      ['k', 'v'],
      [
        ['x', 1],
        ['y', 2],
      ]
    );
    // Same column values but paired differently: wrong.
    expect(
      resultsMatch(
        ref,
        rs(
          ['k', 'v'],
          [
            ['x', 2],
            ['y', 1],
          ]
        )
      )
    ).toBe(false);
  });

  it('uses a small numeric tolerance', () => {
    const ref = rs(['avg'], [['67.2902617007973']]);
    expect(resultsMatch(ref, rs(['avg'], [[67.29]]))).toBe(true);
    expect(resultsMatch(ref, rs(['avg'], [[67.3]]))).toBe(false);
    expect(resultsMatch(rs(['n'], [[1062235]]), rs(['n'], [[1061235]]))).toBe(false);
  });

  it('treats a UTC-midnight timestamp as a date', () => {
    expect(normalize(new Date('2024-04-03T00:00:00Z'))).toBe('2024-04-03');
    expect(
      resultsMatch(rs(['d'], [['2024-04-03']]), rs(['d'], [[new Date('2024-04-03T00:00:00Z')]]))
    ).toBe(true);
  });

  it('matches two empty results', () => {
    expect(resultsMatch(rs(['id'], []), rs(['event_id'], []))).toBe(true);
  });
});
