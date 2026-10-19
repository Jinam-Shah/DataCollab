import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { getSocket } from '../../services/socket';
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

// Ask the agent a question. Steps stream in over Socket.io while the request is running.
function AgentPanel({ onOpenSql }) {
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState('agent');
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onStep = (step) => {
      if (step.requestId === requestRef.current) setSteps((prev) => [...prev, step]);
    };
    socket.on('agent:step', onStep);
    return () => socket.off('agent:step', onStep);
  }, []);

  const handleAsk = async () => {
    if (!question.trim() || loading) return;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    requestRef.current = requestId;
    setSteps([]);
    setResult(null);
    setError('');
    setLoading(true);
    try {
      const response = await api.post('/api/agent/ask', { question, mode, requestId });
      setResult(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'The agent could not answer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="bg-purple-50 rounded-lg p-4 mb-4 border border-purple-200"
      data-testid="agent-panel"
    >
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium text-gray-900">Ask the data agent</h3>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="text-sm border rounded px-2 py-1"
          aria-label="Mode"
        >
          <option value="agent">Agent (retries on errors)</option>
          <option value="single_shot">Single-shot</option>
        </select>
      </div>

      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          placeholder="e.g. Which region had the highest total sales in March?"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
          disabled={loading}
          aria-label="Question"
        />
        <button
          onClick={handleAsk}
          disabled={loading || !question.trim()}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg disabled:bg-gray-400"
        >
          {loading ? 'Thinking...' : 'Ask'}
        </button>
      </div>

      {steps.length > 0 && (
        <ol className="text-sm text-gray-700 mb-3 space-y-1" data-testid="agent-steps">
          {steps.map((s, i) => (
            <li key={i} className={s.error ? 'text-red-700' : ''}>
              <span className="font-medium">{STEP_LABELS[s.type] || s.type}:</span> {s.message}
            </li>
          ))}
        </ol>
      )}

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-white rounded border p-3" data-testid="agent-result">
          <p className={`mb-2 ${result.status === 'gave_up' ? 'text-red-700' : 'text-gray-900'}`}>
            {result.answer || (result.status === 'answered' ? `${result.rowCount} row(s)` : '')}
          </p>
          {result.sql && (
            <div>
              <pre className="bg-gray-100 text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap">
                {result.sql}
              </pre>
              <div className="flex justify-between items-center mt-2 text-xs text-gray-600">
                <span>
                  {result.attempts.length} attempt(s), {result.latencyMs} ms, run #{result.runId}
                </span>
                {onOpenSql && (
                  <button
                    onClick={() => onOpenSql(result.sql)}
                    className="text-purple-700 underline"
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
  );
}

export default AgentPanel;
