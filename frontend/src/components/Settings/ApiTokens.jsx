import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { Button, Card, CardHeader } from '../ui';

// Workspace API tokens for MCP clients. A new token is shown once and never again.
function ApiTokens({ onCreated }) {
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState(null);

  const load = () => api.get('/api/tokens').then((res) => setTokens(res.data.tokens));
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const res = await api.post('/api/tokens', { name: name || 'MCP client' });
    setCreated(res.data.token.token);
    onCreated?.(res.data.token.token);
    setName('');
    load();
  };

  const revoke = async (id) => {
    if (!window.confirm('Revoke this token? Apps using it lose access immediately.')) return;
    await api.delete(`/api/tokens/${id}`);
    load();
  };

  return (
    <Card data-testid="api-tokens">
      <CardHeader
        title="Access tokens"
        subtitle="A token works like a password for one app. It can only read this workspace."
      />
      <div className="p-5">
        <div className="flex gap-2 mb-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Token name, e.g. Claude Desktop"
            aria-label="Token name"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <Button onClick={create}>Create token</Button>
        </div>
        {created && (
          <div
            className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm mb-3"
            role="status"
          >
            Copy this token now; it will not be shown again. It has been added to the setup snippet
            above.
            <code className="block font-mono break-all mt-1 text-slate-900">{created}</code>
          </div>
        )}
        {tokens.length === 0 ? (
          <p className="text-sm text-slate-500">No tokens yet.</p>
        ) : (
          <ul className="text-sm divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {tokens.map((t) => (
              <li key={t.id} className="px-3 py-2 flex justify-between items-center">
                <span>
                  <span className="font-medium text-slate-900">{t.name}</span>{' '}
                  <span className="text-slate-500 font-mono">{t.token_prefix}…</span>
                </span>
                <button
                  onClick={() => revoke(t.id)}
                  className="text-red-600 text-xs font-medium hover:underline"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default ApiTokens;
