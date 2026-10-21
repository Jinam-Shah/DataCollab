import React from 'react';

const WARNING_STYLE = {
  mixed_types: 'bg-amber-50 border-amber-200 text-amber-900',
  all_empty: 'bg-red-50 border-red-200 text-red-800',
  mostly_empty: 'bg-amber-50 border-amber-200 text-amber-900',
  duplicate_rows: 'bg-amber-50 border-amber-200 text-amber-900',
  ragged_rows: 'bg-amber-50 border-amber-200 text-amber-900',
};

const formatValue = (v) => (v === null || v === undefined ? '—' : String(v));

// Per-column quality summary computed at upload time, shown before the first query.
function QualityReport({ report }) {
  if (!report) return null;
  const problemColumns = new Set(report.warnings.filter((w) => w.column).map((w) => w.column));

  return (
    <div data-testid="quality-report">
      <p className="text-sm text-slate-600 mb-3">
        {report.rowCount.toLocaleString()} rows, {report.columnCount} columns,{' '}
        {report.duplicateRows.toLocaleString()} duplicate rows
      </p>

      {report.warnings.length === 0 ? (
        <p className="text-sm text-emerald-700 mb-3">No problems found.</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {report.warnings.map((w, i) => (
            <li
              key={i}
              className={`text-sm border rounded-lg px-3 py-1.5 ${WARNING_STYLE[w.kind] || ''}`}
              role="alert"
            >
              {w.message}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['Column', 'Type', 'Empty', 'Mixed types', 'Min', 'Max'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left font-medium text-slate-600 border-b border-slate-200"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.columns.map((c) => (
              <tr key={c.sqlName} className={problemColumns.has(c.sqlName) ? 'bg-amber-50' : ''}>
                <td className="px-3 py-1 border-b border-slate-100 font-mono">{c.sqlName}</td>
                <td className="px-3 py-1 border-b border-slate-100">{c.type}</td>
                <td className="px-3 py-1 border-b border-slate-100">{c.emptyPct}%</td>
                <td className="px-3 py-1 border-b border-slate-100">
                  {c.mixedTypes ? 'yes' : 'no'}
                </td>
                <td className="px-3 py-1 border-b border-slate-100">{formatValue(c.min)}</td>
                <td className="px-3 py-1 border-b border-slate-100">{formatValue(c.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default QualityReport;
