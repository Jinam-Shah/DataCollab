import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { getSocket } from '../../services/socket';
import { Alert, Badge, DataTable, Icon, Spinner } from '../ui';
import Citations from './Citations';

const STEP_LABELS = {
  plan: 'Planning',
  get_schema: 'Reading schema',
  search_documents: 'Searching documents',
  write_sql: 'Writing SQL',
  run_sql: 'Running SQL',
  check_result: 'Checking result',
  answer: 'Answering',
  give_up: 'Giving up',
};

const SUGGESTIONS = [
  'How many rows does each table have?',
  'What are the top 5 values by total?',
  'Explain what the columns in my data mean',
];

function Steps({ steps, live, testId }) {
  if (steps.length === 0 && !live) return null;
  return (
    <details open={live} className="group">
      <summary className="cursor-pointer text-xs text-slate-500 select-none">
        {live ? 'Working...' : `${steps.length} step(s)`}
      </summary>
      <ol
        className="mt-2 space-y-1 text-sm text-slate-700 border-l-2 border-slate-200 pl-3"
        data-testid={testId}
      >
        {steps.map((s, i) => (
          <li key={i} className={s.error ? 'text-red-700' : ''}>
            <span className="font-medium">{STEP_LABELS[s.type] || s.type}:</span> {s.message}
          </li>
        ))}
        {live && (
          <li className="flex items-center gap-2 text-slate-400">
            <Spinner className="w-3.5 h-3.5" /> thinking
          </li>
        )}
      </ol>
    </details>
  );
}

function Turn({ turn, latest, onOpenSql }) {
  const { question, steps, result, error, loading } = turn;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-4 py-2 text-sm">
          {question}
        </div>
      </div>
      <div className="flex gap-3">
        <div className="w-8 h-8 shrink-0 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
          <Icon name="sparkles" className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <Steps steps={steps} live={loading} testId={latest ? 'agent-steps' : undefined} />
          {error && <Alert>{error}</Alert>}
          {result && (
            <div
              className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
              data-testid={latest ? 'agent-result' : undefined}
            >
              <p
                className={`text-sm ${result.status === 'gave_up' ? 'text-red-700' : 'text-slate-900'}`}
              >
                {result.answer || (result.status === 'answered' ? `${result.rowCount} row(s)` : '')}
              </p>
              {result.rows?.length > 0 && result.columns?.length > 0 && (
                <DataTable
                  columns={result.columns}
                  rows={result.rows.slice(0, 50)}
                  maxHeight="max-h-64"
                />
              )}
              {result.sql && (
                <div>
                  <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                    {result.sql}
                  </pre>
                  <div className="flex flex-wrap justify-between items-center gap-2 mt-2 text-xs text-slate-500">
                    <span className="flex items-center gap-2">
                      <Badge color={result.status === 'answered' ? 'green' : 'red'}>
                        {result.status}
                      </Badge>
                      {result.attempts.length} attempt(s), {result.latencyMs} ms, run #
                      {result.runId}
                    </span>
                    {onOpenSql && (
                      <button
                        onClick={() => onOpenSql(result.sql)}
                        className="inline-flex items-center gap-1 text-indigo-700 font-medium hover:underline"
                      >
                        Open in editor
                      </button>
                    )}
                  </div>
                </div>
              )}
              <Citations citations={result.citations} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Conversation with the data agent. Each question is answered independently; steps stream in
// over Socket.io while the request runs.
function AgentPanel({ onOpenSql }) {
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState('agent');
  const [turns, setTurns] = useState([]);
  const endRef = useRef(null);
  const loading = turns.some((t) => t.loading);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onStep = (step) =>
      setTurns((prev) =>
        prev.map((t) => (t.id === step.requestId ? { ...t, steps: [...t.steps, step] } : t))
      );
    socket.on('agent:step', onStep);
    return () => socket.off('agent:step', onStep);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [turns]);

  const update = (id, patch) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const ask = async (text = question) => {
    if (!text.trim() || loading) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setTurns((prev) => [
      ...prev,
      { id, question: text, steps: [], result: null, error: '', loading: true },
    ]);
    setQuestion('');
    try {
      const response = await api.post('/api/agent/ask', { question: text, mode, requestId: id });
      update(id, { result: response.data, loading: false });
    } catch (err) {
      update(id, {
        error: err.response?.data?.error || 'The agent could not answer',
        loading: false,
      });
    }
  };

  return (
    <div
      className="flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm"
      data-testid="agent-panel"
    >
      <div className="flex-1 p-5 space-y-6 min-h-[320px]">
        {turns.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 mx-auto rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
              <Icon name="sparkles" className="w-6 h-6" />
            </div>
            <p className="font-medium text-slate-900">Ask a question about your data</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              The agent reads your table schemas and documents, writes SQL, runs it, and fixes its
              own mistakes. You see every step.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuestion(s)}
                  className="px-3 py-1.5 rounded-full border border-slate-200 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t, i) => (
            <Turn key={t.id} turn={t} latest={i === turns.length - 1} onOpenSql={onOpenSql} />
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 p-3 sticky bottom-0 bg-white rounded-b-xl">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
            placeholder="e.g. Which region had the highest total sales in March?"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            disabled={loading}
            aria-label="Question"
          />
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-2 bg-white"
            aria-label="Mode"
            title="Agent retries when a query fails; single-shot tries once"
          >
            <option value="agent">Agent</option>
            <option value="single_shot">Single-shot</option>
          </select>
          <button
            onClick={() => ask()}
            disabled={loading || !question.trim()}
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-indigo-300"
          >
            {loading ? 'Thinking...' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AgentPanel;
