import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { Badge, Button, Card, DataTable, Spinner, Tabs, formatBytes, formatNumber } from '../ui';
import QualityReport from '../FileUpload/QualityReport';

const TYPE_COLOR = {
  INTEGER: 'indigo',
  FLOAT: 'indigo',
  DATE: 'green',
  TIMESTAMP: 'green',
  TEXT: 'gray',
};

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900 mt-0.5 truncate">{value}</p>
    </div>
  );
}

// Everything about one uploaded table: size, columns, data quality and a preview.
function TableDetail({ fileId, onDeleted }) {
  const [file, setFile] = useState(null);
  const [tab, setTab] = useState('quality');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError('');
    api
      .get(`/api/files/${fileId}`)
      .then((res) => !cancelled && setFile(res.data.file))
      .catch(() => !cancelled && setError('Could not load this table'));
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (error) return <Card className="p-6 text-sm text-red-700">{error}</Card>;
  if (!file) {
    return (
      <Card className="p-10 flex justify-center text-slate-400">
        <Spinner className="w-6 h-6" />
      </Card>
    );
  }

  const warnings = file.qualityReport?.warnings?.length ?? 0;
  const remove = async () => {
    if (
      !window.confirm(
        `Delete ${file.originalFilename}? Its table is removed for everyone in the workspace.`
      )
    )
      return;
    await api.delete(`/api/files/${file.id}`);
    onDeleted?.(file.id);
  };

  return (
    <Card>
      <div className="px-5 pt-5 pb-4 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-900 truncate">{file.originalFilename}</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Table{' '}
            <code className="font-mono text-indigo-700 bg-indigo-50 px-1 rounded">
              {file.tableName}
            </code>{' '}
            · uploaded by {file.username}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button icon="code" onClick={() => navigate(`/app/sql?table=${file.id}`)}>
            Query this table
          </Button>
          <Button variant="secondary" icon="sparkles" onClick={() => navigate('/app/ask')}>
            Ask AI
          </Button>
          <Button variant="danger" icon="trash" onClick={remove} aria-label="Delete table">
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 pb-5">
        <Stat label="Rows" value={formatNumber(file.rowCount)} />
        <Stat label="Columns" value={formatNumber(file.columnCount)} />
        <Stat label="File size" value={formatBytes(file.fileSize)} />
        <Stat label="Quality warnings" value={warnings} />
      </div>

      <Tabs
        tabs={[
          { id: 'quality', label: `Data quality${warnings ? ` (${warnings})` : ''}` },
          { id: 'overview', label: 'Columns' },
          { id: 'preview', label: 'Preview' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="p-5">
        {file.status && file.status !== 'ready' && (
          <p className="text-sm text-amber-700 mb-3">
            This file is {file.status}
            {file.error ? `: ${file.error}` : ''}.
          </p>
        )}

        {tab === 'overview' && (
          <div className="flex flex-wrap gap-2">
            {(file.columns || []).map((c) => (
              <span
                key={c.name}
                className="inline-flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm"
              >
                <span className="font-mono text-slate-800">{c.name}</span>
                <Badge color={TYPE_COLOR[c.type] || 'gray'}>{c.type}</Badge>
              </span>
            ))}
          </div>
        )}

        {tab === 'quality' &&
          (file.qualityReport ? (
            <QualityReport report={file.qualityReport} />
          ) : (
            <p className="text-sm text-slate-500">No quality report was recorded for this file.</p>
          ))}

        {tab === 'preview' &&
          (file.preview?.length ? (
            <>
              <p className="text-xs text-slate-500 mb-2">First {file.preview.length} rows</p>
              <DataTable columns={Object.keys(file.preview[0])} rows={file.preview} />
            </>
          ) : (
            <p className="text-sm text-slate-500">No rows to preview.</p>
          ))}
      </div>
    </Card>
  );
}

export default TableDetail;
