import React from 'react';

const WARNING_STYLE = {
  mixed_types: 'bg-orange-50 border-orange-300 text-orange-800',
  all_empty: 'bg-red-50 border-red-300 text-red-800',
  mostly_empty: 'bg-yellow-50 border-yellow-300 text-yellow-800',
  duplicate_rows: 'bg-yellow-50 border-yellow-300 text-yellow-800',
  ragged_rows: 'bg-yellow-50 border-yellow-300 text-yellow-800',
};

const formatValue = (v) => (v === null || v === undefined ? '—' : String(v));

// Per-column quality summary computed at upload time, shown before the first query.
function QualityReport({ report }) {
  if (!report) return null;
  const problemColumns = new Set(report.warnings.filter((w) => w.column).map((w) => w.column));

  return (
    <div className="mb-6" data-testid="quality-report">
      <h3 className="font-medium text-gray-900 mb-2">Data quality</h3>
      <p className="text-sm text-gray-600 mb-3">
        {report.rowCount} rows, {report.columnCount} columns, {report.duplicateRows} duplicate rows
      </p>

      {report.warnings.length === 0 ? (
        <p className="text-sm text-green-700 mb-3">No problems found.</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {report.warnings.map((w, i) => (
            <li
              key={i}
              className={`text-sm border rounded px-3 py-1 ${WARNING_STYLE[w.kind] || ''}`}
              role="alert"
            >
              {w.message}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Column', 'Type', 'Empty', 'Mixed types', 'Min', 'Max'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-gray-700 border-b">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.columns.map((c) => (
              <tr key={c.sqlName} className={problemColumns.has(c.sqlName) ? 'bg-orange-50' : ''}>
                <td className="px-3 py-1 border-b font-mono">{c.sqlName}</td>
                <td className="px-3 py-1 border-b">{c.type}</td>
                <td className="px-3 py-1 border-b">{c.emptyPct}%</td>
                <td className="px-3 py-1 border-b">{c.mixedTypes ? 'yes' : 'no'}</td>
                <td className="px-3 py-1 border-b">{formatValue(c.min)}</td>
                <td className="px-3 py-1 border-b">{formatValue(c.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default QualityReport;
