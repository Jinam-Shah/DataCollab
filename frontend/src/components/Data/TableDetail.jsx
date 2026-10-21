import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { downloadFile } from '../../services/download';
import { Badge, Button, Card, Spinner, Tabs, formatBytes, formatNumber } from '../ui';
import QualityReport from '../FileUpload/QualityReport';
import QueryEditor from '../QueryEditor/QueryEditor';
import AgentPanel from '../Agent/AgentPanel';
import SourcePicker from '../Agent/SourcePicker';
import RowsBrowser from './RowsBrowser';
import { useDocuments } from '../../hooks/useWorkspaceData';

const TYPE_COLOR = {
  INTEGER: 'indigo',
  FLOAT: 'indigo',
  DATE: 'green',
  TIMESTAMP: 'green',
  TEXT: 'gray',
};

export const TABLE_TABS = ['quality', 'columns', 'rows', 'sql', 'ask'];

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900 mt-0.5 truncate">{value}</p>
    </div>
  );
}

// The AI tab of a table: always this table, plus any documents the user adds.
function AskThisTable({ file, files, onOpenSql }) {
  const { documents } = useDocuments();
  const [scope, setScope] = useState({ fileIds: [file.id], documentIds: [] });
  return (
    <div>
      <SourcePicker
        files={files.filter((f) => f.id === file.id)}
        documents={documents}
        value={scope}
        onChange={setScope}
        lockedFileId={file.id}
      />
      <AgentPanel
        scope={scope}
        onOpenSql={onOpenSql}
        intro={`Answers come only from ${file.originalFilename}${
          scope.documentIds.length ? ' and the documents you selected' : ''
        }. Add documents above if they explain this data.`}
        suggestions={[
          'How many rows are there?',
          `What are the columns in ${file.originalFilename}?`,
          'Show the top 5 rows by the largest number column',
        ]}
      />
    </div>
  );
}

// Everything about one uploaded table: data quality, columns, all rows, SQL and AI questions.
function TableDetail({ fileId, files, tab, onTab, initialSql, onDeleted }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [sql, setSql] = useState(initialSql || '');
  const [downloading, setDownloading] = useState(false);
  const active = TABLE_TABS.includes(tab) ? tab : 'quality';

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

  useEffect(() => {
    if (initialSql) setSql(initialSql);
  }, [initialSql]);

  if (error) return <Card className="p-6 text-sm text-red-700">{error}</Card>;
  if (!file) {
    return (
      <Card className="p-10 flex justify-center text-slate-400">
        <Spinner className="w-6 h-6" />
      </Card>
    );
  }

  const ready = file.status === 'ready';
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
  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/api/files/${file.id}/download`, file.originalFilename);
    } finally {
      setDownloading(false);
    }
  };
  const openSql = (query) => {
    setSql(query);
    onTab('sql');
  };

  return (
    <Card>
      <div className="px-5 pt-5 pb-4 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-900 truncate">{file.originalFilename}</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            SQL table name{' '}
            <code className="font-mono text-indigo-700 bg-indigo-50 px-1 rounded">
              {file.tableName}
            </code>{' '}
            · uploaded by {file.username}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="secondary"
            icon="download"
            onClick={download}
            disabled={!ready || downloading}
          >
            {downloading ? 'Preparing...' : 'Download CSV'}
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
          { id: 'columns', label: 'Columns' },
          { id: 'rows', label: 'All rows' },
          { id: 'sql', label: 'SQL query' },
          { id: 'ask', label: 'Ask AI' },
        ]}
        active={active}
        onChange={onTab}
      />

      <div className="p-5">
        {!ready && (
          <p className="text-sm text-amber-700 mb-3">
            This file is {file.status}
            {file.error ? `: ${file.error}` : ''}.
          </p>
        )}

        {active === 'quality' &&
          (file.qualityReport ? (
            <QualityReport report={file.qualityReport} />
          ) : (
            <p className="text-sm text-slate-500">No quality report was recorded for this file.</p>
          ))}

        {active === 'columns' && (
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

        {active === 'rows' && ready && <RowsBrowser fileId={file.id} />}

        {active === 'sql' && ready && (
          <div>
            <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 mb-4 text-sm">
              <span className="text-indigo-900">
                Querying <strong>{file.originalFilename}</strong>. In SQL this table is called{' '}
                <code className="font-mono bg-white px-1 rounded">{file.tableName}</code>.
                {files.length > 1 && (
                  <span className="block text-xs text-indigo-800/80 mt-1">
                    To combine it with another file, JOIN by table name:{' '}
                    {files
                      .filter((f) => f.id !== file.id)
                      .map((f) => f.table_name)
                      .join(', ')}
                  </span>
                )}
              </span>
            </div>
            <QueryEditor selectedFile={file} initialQuery={sql} />
          </div>
        )}

        {active === 'ask' && ready && (
          <AskThisTable file={file} files={files} onOpenSql={openSql} />
        )}
      </div>
    </Card>
  );
}

export default TableDetail;
