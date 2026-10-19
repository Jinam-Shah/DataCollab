import React, { useEffect, useState } from 'react';
import api from '../../services/api';

// Workspace API tokens for MCP clients. A new token is shown once and never again.
function ApiTokens() {
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
    setName('');
    load();
  };

  const revoke = async (id) => {
    await api.delete(`/api/tokens/${id}`);
    load();
  };

  return (
    <div className="bg-white rounded-lg shadow p-6" data-testid="api-tokens">
      <h2 className="text-xl font-bold text-gray-900 mb-1">MCP access</h2>
      <p className="text-sm text-gray-600 mb-3">
        Tokens let an MCP client (for example Claude Desktop) list tables and run read-only queries
        in this workspace.
      </p>
      <div className="flex gap-2 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name"
          aria-label="Token name"
          className="flex-1 px-3 py-1 border rounded"
        />
        <button onClick={create} className="bg-gray-800 text-white px-3 py-1 rounded">
          Create token
        </button>
      </div>
      {created && (
        <div
          className="bg-yellow-50 border border-yellow-300 rounded p-2 text-sm mb-3"
          role="status"
        >
          Copy this token now; it will not be shown again:
          <code className="block font-mono break-all mt-1">{created}</code>
        </div>
      )}
      <ul className="text-sm divide-y">
        {tokens.map((t) => (
          <li key={t.id} className="py-1 flex justify-between">
            <span>
              {t.name} <span className="text-gray-500 font-mono">{t.token_prefix}…</span>
            </span>
            <button onClick={() => revoke(t.id)} className="text-red-600 hover:underline">
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ApiTokens;
