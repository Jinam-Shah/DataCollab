import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { Button, DataTable, Spinner, formatNumber } from '../ui';

const PAGE_SIZES = [50, 100, 250, 500];

// Every row of a table, a page at a time, in the order they were uploaded.
function RowsBrowser({ fileId }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get(`/api/files/${fileId}/rows?page=${page}&pageSize=${pageSize}`)
      .then((res) => !cancelled && setData(res.data))
      .catch((err) => !cancelled && setError(err.response?.data?.error || 'Could not load rows'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fileId, page, pageSize]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-10 text-slate-400">
        <Spinner className="w-6 h-6" />
      </div>
    );
  }

  const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
  const from = data.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, data.total);

  return (
    <div data-testid="rows-browser">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-slate-600">
          Rows {formatNumber(from)}–{formatNumber(to)} of {formatNumber(data.total)}
          {loading && <Spinner className="inline w-3.5 h-3.5 ml-2 text-slate-400" />}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-slate-600">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="border border-slate-300 rounded-md px-2 py-1 bg-white"
              aria-label="Rows per page"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" size="sm" onClick={() => setPage(1)} disabled={page <= 1}>
            First
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
          >
            Prev
          </Button>
          <span className="text-slate-600">
            Page {page} of {lastPage}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(page + 1)}
            disabled={page >= lastPage}
          >
            Next
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(lastPage)}
            disabled={page >= lastPage}
          >
            Last
          </Button>
        </div>
      </div>
      {data.rows.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-6">This table has no rows.</p>
      ) : (
        <DataTable columns={data.columns} rows={data.rows} maxHeight="max-h-[60vh]" />
      )}
    </div>
  );
}

export default RowsBrowser;
