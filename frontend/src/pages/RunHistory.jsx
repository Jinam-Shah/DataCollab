import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const show = (value) => {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

// Every agent run in the workspace, with its recorded steps.
function RunHistory() {
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/api/agent/runs?limit=50')
      .then((res) => setRuns(res.data.runs))
      .catch(() => setError('Failed to load runs'));
  }, []);

  const openRun = async (id) => {
    const res = await api.get(`/api/agent/runs/${id}`);
    setSelected(res.data);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Agent run history</h1>
          <Link to="/dashboard" className="text-blue-600 underline">
            Back to dashboard
          </Link>
        </div>
      </nav>
      <div className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-4">
          {error && <p className="text-red-700">{error}</p>}
          {runs.length === 0 && !error && <p className="text-gray-600">No runs yet.</p>}
          <ul className="divide-y">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => openRun(r.id)}
                  className="w-full text-left py-2 hover:bg-gray-50"
                >
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-900">{r.question}</span>
                    <span className={r.status === 'answered' ? 'text-green-700' : 'text-red-700'}>
                      {r.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    #{r.id} · {r.mode} · {r.model} · {r.attempts} attempt(s) · {r.latency_ms} ms ·{' '}
                    {r.username || r.source}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white rounded-lg shadow p-4" data-testid="run-detail">
          {!selected && <p className="text-gray-600">Select a run to see its steps.</p>}
          {selected && (
            <div>
              <h2 className="font-bold text-gray-900 mb-1">{selected.run.question}</h2>
              <p className="text-sm text-gray-700 mb-3">{selected.run.answer}</p>
              <ol className="space-y-3">
                {selected.steps.map((s) => (
                  <li key={s.step_index} className="border rounded p-2 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">
                        {s.step_index + 1}. {s.step_type}
                        {s.tool_name ? ` → ${s.tool_name}` : ''}
                      </span>
                      <span className="text-gray-500">
                        {s.latency_ms} ms
                        {s.input_tokens ? ` · ${s.input_tokens}/${s.output_tokens} tok` : ''}
                      </span>
                    </div>
                    {s.error && <p className="text-red-700">{s.error}</p>}
                    {s.tool_input && (
                      <pre className="bg-gray-100 text-xs p-2 mt-1 rounded overflow-x-auto">
                        {show(s.tool_input)}
                      </pre>
                    )}
                    {s.prompt && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-gray-600">Prompt</summary>
                        <pre className="bg-gray-50 text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap">
                          {s.prompt}
                        </pre>
                      </details>
                    )}
                    {s.tool_output && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-gray-600">Output</summary>
                        <pre className="bg-gray-50 text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap">
                          {show(s.tool_output)}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RunHistory;
