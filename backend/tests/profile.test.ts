import path from 'path';
import fs from 'fs';
import os from 'os';
import { profileCsv } from '../ingest/profile';

const fixture = path.join(__dirname, 'fixtures', 'quality.csv');

function tmpCsv(text: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dc-')), 'f.csv');
  fs.writeFileSync(file, text);
  return file;
}

describe('profileCsv quality report', () => {
  it('infers types over all rows', async () => {
    const { columns } = await profileCsv(fixture);
    expect(columns.map((c) => [c.sqlName, c.type])).toEqual([
      ['id', 'INTEGER'],
      ['name', 'TEXT'],
      ['amount', 'FLOAT'],
      ['joined', 'DATE'],
      ['code', 'TEXT'],
    ]);
  });

  it('counts empty values, duplicates and numeric min/max', async () => {
    const { report } = await profileCsv(fixture);
    expect(report.rowCount).toBe(5);
    expect(report.duplicateRows).toBe(1);
    const amount = report.columns.find((c) => c.sqlName === 'amount')!;
    expect(amount.emptyCount).toBe(1);
    expect(amount.emptyPct).toBe(20);
    expect(amount.min).toBe(-3);
    expect(amount.max).toBe(100);
    const joined = report.columns.find((c) => c.sqlName === 'joined')!;
    expect([joined.min, joined.max]).toEqual(['2024-01-05', '2024-03-01']);
  });

  it('flags columns that mix numbers and text', async () => {
    const { report } = await profileCsv(fixture);
    const code = report.columns.find((c) => c.sqlName === 'code')!;
    expect(code.mixedTypes).toBe(true);
    expect(code.typeCounts).toMatchObject({ INTEGER: 2, TEXT: 3 });
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: 'code', kind: 'mixed_types' }),
        expect.objectContaining({ column: null, kind: 'duplicate_rows' }),
      ])
    );
  });

  it('does not call integers mixed with floats "mixed"', async () => {
    const { report } = await profileCsv(fixture);
    expect(report.columns.find((c) => c.sqlName === 'amount')!.mixedTypes).toBe(false);
  });

  it('warns about mostly empty and fully empty columns', async () => {
    const file = tmpCsv('a,b,c\n1,,\n2,,x\n3,,\n');
    const { report } = await profileCsv(file);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: 'b', kind: 'all_empty' }),
        expect.objectContaining({ column: 'c', kind: 'mostly_empty' }),
      ])
    );
  });

  it('gives duplicate or blank headers unique SQL names', async () => {
    const file = tmpCsv('Total Sales,total_sales,,row_id\n1,2,3,4\n');
    const { columns } = await profileCsv(file);
    expect(columns.map((c) => c.sqlName)).toEqual([
      'total_sales',
      'total_sales_2',
      'column_3',
      'row_id_2',
    ]);
  });

  it('keeps integers beyond 32 bits exact', async () => {
    const file = tmpCsv('big\n9007199254740993\n1\n');
    const { columns } = await profileCsv(file);
    expect(columns[0]).toMatchObject({ type: 'INTEGER', big: true });
  });
});
