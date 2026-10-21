import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import api from '../../services/api';
import TextToSQL from '../AIQuery/TextToSQL';
import ChartBuilder from '../Visualizations/ChartBuilder';
import { Alert, Badge, Button, Card, DataTable, Spinner } from '../ui';

const PAGE_SIZE = 100;

// SQL editor for the workspace. Queries run through the read-only safety layer on the server:
// one SELECT at a time, 5 s timeout, at most 1000 rows per page.
function QueryEditor({ selectedFile, initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const runRef = useRef(null);

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);

  const handleRunQuery = async (page = 1) => {
    if (!query.trim()) {
      setError('Please enter a query');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/api/queries/execute', { query, page, pageSize: PAGE_SIZE });
      if (response.data.success) {
        setResults(response.data);
      } else {
        setError(response.data.error);
        setResults(null);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Query execution failed');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };
  runRef.current = handleRunQuery;

  if (!selectedFile) {
    return (
      <Card className="p-8 text-center text-slate-500 text-sm">
        Please select a file first to run queries
      </Card>
    );
  }

  const tableName = selectedFile.tableName || selectedFile.table_name;
  const samples = [
    { title: 'View all data', query: `SELECT * FROM "${tableName}" LIMIT 100` },
    { title: 'Count rows', query: `SELECT COUNT(*) as total FROM "${tableName}"` },
    { title: 'Get first 10 rows', query: `SELECT * FROM "${tableName}" LIMIT 10` },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
          <span className="text-xs font-medium text-slate-500 mr-1">Examples:</span>
          {samples.map((s) => (
            <button
              key={s.title}
              onClick={() => setQuery(s.query)}
              className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-xs hover:bg-slate-200"
            >
              {s.title}
            </button>
          ))}
        </div>

        <div className="px-4 pt-4">
          <TextToSQL selectedFile={selectedFile} onQueryGenerated={(sql) => setQuery(sql)} />
        </div>

        <div className="p-4">
          <div className="border border-slate-300 rounded-lg overflow-hidden">
            <Editor
              height="220px"
              defaultLanguage="sql"
              value={query}
              onChange={(value) => setQuery(value || '')}
              onMount={(editor, monaco) => {
                // Ctrl/Cmd + Enter runs the query.
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
                  runRef.current(1)
                );
              }}
              theme="vs-light"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 8 },
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-slate-500">
              Read-only: one SELECT at a time, 5 s limit. Ctrl/Cmd + Enter runs the query.
            </p>
            <Button
              variant="success"
              icon="play"
              onClick={() => handleRunQuery(1)}
              disabled={loading || !query.trim()}
            >
              {loading ? 'Executing...' : 'Run Query'}
            </Button>
          </div>
          {error && (
            <div className="mt-3">
              <Alert>
                <strong>Error:</strong> {error}
              </Alert>
            </div>
          )}
        </div>
      </Card>

      {results && results.success && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 text-sm">
              Results ({results.rowCount} rows{results.hasMore ? ', more available' : ''})
            </h3>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {results.cached && <Badge color="green">from cache</Badge>}
              <span>Executed in {results.executionTime}ms</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleRunQuery(results.page - 1)}
                disabled={loading || results.page <= 1}
              >
                Prev
              </Button>
              <span>Page {results.page}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleRunQuery(results.page + 1)}
                disabled={loading || !results.hasMore}
              >
                Next
              </Button>
              {loading && <Spinner />}
            </div>
          </div>
          <div className="p-4">
            {results.data.length === 0 ? (
              <p className="text-center py-6 text-sm text-slate-500">Query returned no results</p>
            ) : (
              <DataTable columns={results.columns} rows={results.data} />
            )}
          </div>
        </Card>
      )}

      <ChartBuilder queryResults={results} />
    </div>
  );
}

export default QueryEditor;
