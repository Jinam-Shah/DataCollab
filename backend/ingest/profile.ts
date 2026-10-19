// First pass over an uploaded CSV: infer column types and build the quality report.
// Streams the file, so memory grows with the number of distinct rows (for duplicate
// detection, 16 bytes of hash per row) rather than with the file size.
import fs from 'fs';
import crypto from 'crypto';
const csv = require('csv-parser');
const CSVService = require('../services/csvService');

export type ValueType = 'INTEGER' | 'FLOAT' | 'DATE' | 'TIMESTAMP' | 'TEXT';

export interface ProfiledColumn {
  name: string; // header as written in the file
  sqlName: string; // sanitized, unique column name in the table
  index: number;
  type: ValueType;
  big: boolean; // integers outside the 32-bit range
  samples: string[];
}

export interface ColumnQuality {
  name: string;
  sqlName: string;
  type: ValueType;
  emptyCount: number;
  emptyPct: number;
  typeCounts: Record<ValueType, number>;
  mixedTypes: boolean;
  distinctSampled: number;
  min: number | string | null;
  max: number | string | null;
}

export interface QualityWarning {
  column: string | null;
  kind: 'all_empty' | 'mostly_empty' | 'mixed_types' | 'duplicate_rows' | 'ragged_rows';
  message: string;
}

export interface QualityReport {
  rowCount: number;
  columnCount: number;
  duplicateRows: number;
  duplicatePct: number;
  raggedRows: number;
  columns: ColumnQuality[];
  warnings: QualityWarning[];
}

export interface Profile {
  columns: ProfiledColumn[];
  rowCount: number;
  report: QualityReport;
}

const MOSTLY_EMPTY_PCT = 50;
const INT32_MAX = 2147483647;
const DISTINCT_CAP = 1000;

interface Acc {
  type: ValueType | null;
  empty: number;
  counts: Record<ValueType, number>;
  maxAbsInt: number;
  numMin: number;
  numMax: number;
  strMin: string | null;
  strMax: string | null;
  distinct: Set<string>;
  samples: string[];
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 10000) / 100);

export async function profileCsv(filePath: string): Promise<Profile> {
  let headers: string[] = [];
  let accs: Acc[] = [];
  let rowCount = 0;
  let raggedRows = 0;
  let duplicateRows = 0;
  const seen = new Set<string>();

  const stream = fs.createReadStream(filePath).pipe(
    csv({ strict: false }).on('headers', (h: string[]) => {
      headers = h;
      accs = h.map(() => ({
        type: null,
        empty: 0,
        counts: { INTEGER: 0, FLOAT: 0, DATE: 0, TIMESTAMP: 0, TEXT: 0 },
        maxAbsInt: 0,
        numMin: Infinity,
        numMax: -Infinity,
        strMin: null,
        strMax: null,
        distinct: new Set<string>(),
        samples: [],
      }));
    })
  );

  for await (const row of stream as AsyncIterable<Record<string, string>>) {
    rowCount++;
    if (Object.keys(row).length !== headers.length) raggedRows++;

    const values = headers.map((h) => row[h] ?? '');
    const hash = crypto
      .createHash('sha1')
      .update(JSON.stringify(values))
      .digest('base64')
      .slice(0, 16);
    if (seen.has(hash)) duplicateRows++;
    else seen.add(hash);

    values.forEach((raw, i) => {
      const acc = accs[i];
      if (acc.samples.length < 5) acc.samples.push(raw);
      const v = raw.trim();
      if (v === '') {
        acc.empty++;
        return;
      }
      const t = CSVService.detectDataType(v) as ValueType;
      acc.counts[t]++;
      acc.type = CSVService.widenType(acc.type, t);
      if (acc.distinct.size < DISTINCT_CAP) acc.distinct.add(v);
      if (t === 'INTEGER' || t === 'FLOAT') {
        const n = Number(v);
        if (t === 'INTEGER') acc.maxAbsInt = Math.max(acc.maxAbsInt, Math.abs(n));
        if (n < acc.numMin) acc.numMin = n;
        if (n > acc.numMax) acc.numMax = n;
      } else if (t === 'DATE' || t === 'TIMESTAMP') {
        const iso =
          t === 'DATE' ? CSVService.convertValue(v, { type: 'DATE' }) : new Date(v).toISOString();
        if (acc.strMin === null || iso < acc.strMin) acc.strMin = iso;
        if (acc.strMax === null || iso > acc.strMax) acc.strMax = iso;
      }
    });
  }

  const used = new Set(['row_id']);
  const columns: ProfiledColumn[] = headers.map((name, index) => {
    const acc = accs[index];
    let sqlName = CSVService.sanitizeColumnName(name) || `column_${index + 1}`;
    const base = sqlName;
    for (let n = 2; used.has(sqlName); n++) sqlName = `${base.substring(0, 58)}_${n}`;
    used.add(sqlName);
    const type = acc.type ?? 'TEXT';
    return {
      name,
      sqlName,
      index,
      type,
      big: type === 'INTEGER' && acc.maxAbsInt > INT32_MAX,
      samples: acc.samples,
    };
  });

  const warnings: QualityWarning[] = [];
  const quality: ColumnQuality[] = columns.map((col, i) => {
    const acc = accs[i];
    const numeric = acc.counts.INTEGER + acc.counts.FLOAT;
    // "Mixed" means values of different kinds (number, date, text), not ints mixed with floats.
    const dates = acc.counts.DATE + acc.counts.TIMESTAMP;
    const kinds = [numeric, dates, acc.counts.TEXT].filter((n) => n > 0).length;
    const mixedTypes = kinds > 1;
    const emptyPct = pct(acc.empty, rowCount);
    const isNumeric = col.type === 'INTEGER' || col.type === 'FLOAT';
    const isTime = col.type === 'DATE' || col.type === 'TIMESTAMP';

    if (rowCount > 0 && acc.empty === rowCount) {
      warnings.push({
        column: col.sqlName,
        kind: 'all_empty',
        message: `"${col.name}" has no values`,
      });
    } else if (emptyPct >= MOSTLY_EMPTY_PCT) {
      warnings.push({
        column: col.sqlName,
        kind: 'mostly_empty',
        message: `"${col.name}" is ${emptyPct}% empty`,
      });
    }
    if (mixedTypes) {
      const filled = rowCount - acc.empty;
      const parts = [
        numeric && `${pct(numeric, filled)}% numbers`,
        dates && `${pct(dates, filled)}% dates`,
        acc.counts.TEXT && `${pct(acc.counts.TEXT, filled)}% text`,
      ].filter(Boolean);
      warnings.push({
        column: col.sqlName,
        kind: 'mixed_types',
        message: `"${col.name}" mixes ${parts.join(', ')}; stored as TEXT`,
      });
    }

    return {
      name: col.name,
      sqlName: col.sqlName,
      type: col.type,
      emptyCount: acc.empty,
      emptyPct,
      typeCounts: acc.counts,
      mixedTypes,
      distinctSampled: acc.distinct.size,
      min: isNumeric && acc.numMin !== Infinity ? acc.numMin : isTime ? acc.strMin : null,
      max: isNumeric && acc.numMax !== -Infinity ? acc.numMax : isTime ? acc.strMax : null,
    };
  });

  if (duplicateRows > 0) {
    warnings.push({
      column: null,
      kind: 'duplicate_rows',
      message: `${duplicateRows} duplicate row(s) (${pct(duplicateRows, rowCount)}%)`,
    });
  }
  if (raggedRows > 0) {
    warnings.push({
      column: null,
      kind: 'ragged_rows',
      message: `${raggedRows} row(s) have a different number of fields than the header`,
    });
  }

  return {
    columns,
    rowCount,
    report: {
      rowCount,
      columnCount: columns.length,
      duplicateRows,
      duplicatePct: pct(duplicateRows, rowCount),
      raggedRows,
      columns: quality,
      warnings,
    },
  };
}
