import React, { useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Icon,
  PageHeader,
  Spinner,
  formatNumber,
} from '../components/ui';
import FileUpload from '../components/FileUpload/FileUpload';
import TableDetail from '../components/Data/TableDetail';
import { useFiles } from '../hooks/useWorkspaceData';

function statusBadge(file) {
  if (file.status === 'ready' || !file.status) return null;
  return <Badge color={file.status === 'failed' ? 'red' : 'amber'}>{file.status}</Badge>;
}

// Tables in the workspace on the left; the selected table's details on the right.
function DataPage() {
  const { files, loading, reload } = useFiles();
  const { fileId, tab } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const selectedId = fileId ? Number(fileId) : null;

  const onUploaded = useCallback(
    (file) => {
      reload();
      if (file?.id) navigate(`/app/data/${file.id}`);
    },
    [reload, navigate]
  );

  return (
    <div>
      <PageHeader
        title="Data"
        description="Upload CSV files. Pick a table to check its quality, browse or download every row, query it with SQL, or ask the AI about it. Everyone in your workspace sees the same tables."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Upload a CSV"
              subtitle="Up to 50 MB. Large files load in the background."
            />
            <div className="p-4">
              <FileUpload onUploadSuccess={onUploaded} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Tables" subtitle={`${files.length} in this workspace`} />
            {loading ? (
              <div className="p-6 flex justify-center text-slate-400">
                <Spinner />
              </div>
            ) : files.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 text-center">No files uploaded yet</p>
            ) : (
              <ul className="divide-y divide-slate-100" data-testid="table-list">
                {files.map((f) => (
                  <li key={f.id}>
                    <button
                      // Keep the open tab when switching tables (e.g. stay on SQL query).
                      onClick={() => navigate(`/app/data/${f.id}${tab ? `/${tab}` : ''}`)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition ${
                        selectedId === f.id ? 'bg-indigo-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <Icon
                        name="table"
                        className={`w-5 h-5 mt-0.5 ${selectedId === f.id ? 'text-indigo-600' : 'text-slate-400'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-slate-900 truncate">
                            {f.original_filename}
                          </span>
                          {statusBadge(f)}
                        </span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                          {f.status && f.status !== 'ready'
                            ? f.error || 'Processing...'
                            : `${formatNumber(f.row_count)} rows · ${f.column_count} columns · ${f.username}`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0">
          {selectedId ? (
            <TableDetail
              key={selectedId}
              fileId={selectedId}
              files={files}
              tab={tab}
              onTab={(t) => navigate(`/app/data/${selectedId}/${t}`)}
              initialSql={search.get('sql') || ''}
              onDeleted={() => navigate('/app/data')}
            />
          ) : (
            <Card>
              <EmptyState
                icon="table"
                title={files.length ? 'Select a table' : 'Upload your first CSV'}
              >
                {files.length
                  ? 'Pick a table on the left. Its tabs let you browse all rows, write SQL and ask the AI about that table.'
                  : 'Drop a CSV file in the upload box. You will get a data quality report before your first query.'}
              </EmptyState>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default DataPage;
