import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import QueryEditor from '../components/QueryEditor/QueryEditor';
import { useFiles } from '../hooks/useWorkspaceData';

// SQL editor. ?table=<fileId> picks the table, ?sql=<query> pre-fills the editor
// (used by "Open in editor" on the Ask AI page).
function SqlPage() {
  const { files, loading } = useFiles();
  const [params, setParams] = useSearchParams();
  const ready = files.filter((f) => !f.status || f.status === 'ready');
  const tableParam = Number(params.get('table'));
  const selectedFile = ready.find((f) => f.id === tableParam) || ready[0] || null;
  const initialQuery = params.get('sql') || '';

  const pick = (id) => {
    const next = new URLSearchParams(params);
    next.set('table', id);
    next.delete('sql');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="SQL"
        description="Run read-only SQL against the tables in your workspace. You can join tables; each one is shown with its table name below."
        actions={
          ready.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Table
              <select
                value={selectedFile?.id || ''}
                onChange={(e) => pick(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Table"
              >
                {ready.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.original_filename}
                  </option>
                ))}
              </select>
            </label>
          )
        }
      />

      {loading ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="w-6 h-6" />
        </div>
      ) : !selectedFile ? (
        <Card>
          <EmptyState
            icon="table"
            title="No tables yet"
            action={
              <Link to="/app/data" className="text-sm font-medium text-indigo-600 hover:underline">
                Upload a CSV on the Data page
              </Link>
            }
          >
            Queries run against the tables created from your CSV uploads.
          </EmptyState>
        </Card>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-3">
            Table name:{' '}
            <code className="font-mono bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded">
              {selectedFile.table_name}
            </code>
          </p>
          <QueryEditor
            key={selectedFile.id}
            selectedFile={selectedFile}
            initialQuery={initialQuery}
          />
        </>
      )}
    </div>
  );
}

export default SqlPage;
