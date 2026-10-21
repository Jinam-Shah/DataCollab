import React, { useState } from 'react';
import api from '../../services/api';
import { Icon, Spinner } from '../ui';

// Single-shot AI assist: turns one sentence into SQL for the selected table and puts it in the
// editor for review. (The Ask AI page uses the full agent with retries instead.)
function TextToSQL({ selectedFile, onQueryGenerated }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/api/ai/text-to-sql', { question, fileId: selectedFile.id });
      if (response.data.success) {
        onQueryGenerated?.(response.data.query);
        setQuestion('');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate SQL');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
      <div className="flex items-center gap-2">
        <Icon name="sparkles" className="w-4 h-4 text-indigo-600 shrink-0" />
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generate()}
          className="flex-1 bg-white px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder={`Describe a query on ${selectedFile.tableName || selectedFile.table_name}, e.g. "count rows per category"`}
          disabled={loading}
          aria-label="Describe the query"
        />
        <button
          onClick={generate}
          disabled={loading || !question.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-indigo-300"
        >
          {loading && <Spinner className="w-3.5 h-3.5" />}
          Generate SQL
        </button>
      </div>
      {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
    </div>
  );
}

export default TextToSQL;
