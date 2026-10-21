import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '../components/ui';

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
    <div>
      <PageHeader
        title="Run history"
        description="Every question asked to the AI in this workspace (from the app or from an MCP client), with each step it took, the prompts it sent and the time it spent."
      />
      <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] gap-6 items-start">
        <Card>
          <CardHeader title="Runs" subtitle={`${runs.length} most recent`} />
          {error && <p className="p-4 text-sm text-red-700">{error}</p>}
          {runs.length === 0 && !error && (
            <p className="p-6 text-sm text-slate-500 text-center">No runs yet.</p>
          )}
          <ul className="divide-y divide-slate-100">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => openRun(r.id)}
                  className={`w-full text-left px-4 py-3 ${selected?.run.id === r.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-900">{r.question}</span>
                    <span className="shrink-0 self-start">
                      <Badge color={r.status === 'answered' ? 'green' : 'red'}>{r.status}</Badge>
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    #{r.id} · {r.mode} · {r.attempts} attempt(s) · {r.latency_ms} ms ·{' '}
                    {r.username || r.source}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card data-testid="run-detail">
          {!selected ? (
            <EmptyState icon="history" title="Select a run">
              See every step the agent took for that question.
            </EmptyState>
          ) : (
            <div className="p-5">
              <h2 className="font-semibold text-slate-900">{selected.run.question}</h2>
              <p className="text-sm text-slate-700 mt-1 mb-1">{selected.run.answer}</p>
              <p className="text-xs text-slate-500 mb-4">Model {selected.run.model}</p>
              <ol className="space-y-3">
                {selected.steps.map((s) => (
                  <li key={s.step_index} className="border border-slate-200 rounded-lg p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-slate-900">
                        {s.step_index + 1}. {s.step_type}
                        {s.tool_name ? ` → ${s.tool_name}` : ''}
                      </span>
                      <span className="text-xs text-slate-500">
                        {s.latency_ms} ms
                        {s.input_tokens ? ` · ${s.input_tokens}/${s.output_tokens} tok` : ''}
                      </span>
                    </div>
                    {s.error && <p className="text-red-700 mt-1">{s.error}</p>}
                    {s.tool_input && (
                      <pre className="bg-slate-50 text-xs p-2 mt-2 rounded overflow-x-auto">
                        {show(s.tool_input)}
                      </pre>
                    )}
                    {s.prompt && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-slate-500">Prompt</summary>
                        <pre className="bg-slate-50 text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap">
                          {s.prompt}
                        </pre>
                      </details>
                    )}
                    {s.tool_output && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-slate-500">Output</summary>
                        <pre className="bg-slate-50 text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap">
                          {show(s.tool_output)}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default RunHistory;
