import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import api from '../../services/api';
import TextToSQL from '../AIQuery/TextToSQL';
import ChartBuilder from '../Visualizations/ChartBuilder';

function QueryEditor({ selectedFile }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRunQuery = async () => {
    if (!query.trim()) {
      setError('Please enter a query');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await api.post('/api/queries/execute', {
        query: query,
        fileId: selectedFile?.id,
      });

      if (response.data.success) {
        setResults(response.data);
        setError('');
      } else {
        setError(response.data.error);
        setResults(null);
      }
    } catch (err) {
      console.error('Query error:', err);
      setError(err.response?.data?.error || 'Query execution failed');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const loadSampleQuery = (sampleQuery) => {
    setQuery(sampleQuery);
  };

  const getSampleQueries = () => {
    if (!selectedFile) return [];

    const tableName = selectedFile.tableName || `csv_data_${selectedFile.id}`;

    return [
      {
        title: 'View all data',
        query: `SELECT * FROM "${tableName}" LIMIT 100`,
      },
      {
        title: 'Count rows',
        query: `SELECT COUNT(*) as total FROM "${tableName}"`,
      },
      {
        title: 'Get first 10 rows',
        query: `SELECT * FROM "${tableName}" LIMIT 10`,
      },
    ];
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-900">SQL Query Editor</h2>
        {selectedFile && (
          <span className="text-sm text-gray-600">
            Table:{' '}
            <span className="font-mono text-blue-600">
              {selectedFile.tableName || `csv_data_${selectedFile.id}`}
            </span>
          </span>
        )}
      </div>

      {!selectedFile && (
        <div className="text-center py-8 text-gray-600">
          Please select a file first to run queries
        </div>
      )}

      {selectedFile && (
        <>
          <TextToSQL
            selectedFile={selectedFile}
            onQueryGenerated={(generatedQuery) => setQuery(generatedQuery)}
          />
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Sample Queries:</label>
            <div className="flex flex-wrap gap-2">
              {getSampleQueries().map((sample, index) => (
                <button
                  key={index}
                  onClick={() => loadSampleQuery(sample.query)}
                  className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm transition"
                >
                  {sample.title}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">SQL Query:</label>
            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <Editor
                height="200px"
                defaultLanguage="sql"
                value={query}
                onChange={(value) => setQuery(value || '')}
                theme="vs-light"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
          </div>
          <button
            onClick={handleRunQuery}
            disabled={loading || !query.trim()}
            className="w-full bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
          >
            {loading ? 'Executing...' : 'Run Query'}
          </button>
          {error && (
            <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              <strong>Error:</strong> {error}
            </div>
          )}
          {results && results.success && (
            <div className="mt-6">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium text-gray-900">Results ({results.rowCount} rows)</h3>
                <span className="text-sm text-gray-600">Executed in {results.executionTime}ms</span>
              </div>

              {results.data.length === 0 ? (
                <div className="text-center py-4 text-gray-600">Query returned no results</div>
              ) : (
                <div className="overflow-x-auto border border-gray-300 rounded-lg">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        {results.columns.map((col) => (
                          <th
                            key={col}
                            className="px-4 py-2 border-b text-left text-sm font-medium text-gray-700"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.data.map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-gray-50">
                          {results.columns.map((col) => (
                            <td key={col} className="px-4 py-2 border-b text-sm text-gray-900">
                              {row[col] !== null && row[col] !== undefined
                                ? String(row[col])
                                : 'null'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}{' '}
          <ChartBuilder queryResults={results} />
        </>
      )}
    </div>
  );
}

export default QueryEditor;
