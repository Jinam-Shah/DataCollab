import React, { useState } from 'react';
import api from '../../services/api';

// Sources behind a document-based answer. Clicking one shows the full passage.
function Citations({ citations }) {
  const [open, setOpen] = useState(null);
  const [chunk, setChunk] = useState(null);

  if (!citations || citations.length === 0) return null;

  const toggle = async (c) => {
    if (open === c.n) {
      setOpen(null);
      return;
    }
    setOpen(c.n);
    setChunk(null);
    const res = await api.get(`/api/documents/${c.documentId}/chunks/${c.chunkId}`);
    setChunk(res.data.chunk);
  };

  return (
    <div className="mt-3" data-testid="citations">
      <p className="text-xs font-medium text-gray-700 mb-1">Sources</p>
      <ol className="space-y-1">
        {citations.map((c) => (
          <li key={c.n} className="text-xs">
            <button onClick={() => toggle(c)} className="text-indigo-700 hover:underline text-left">
              [{c.n}] {c.filename}
              {c.page ? `, page ${c.page}` : ''}
              {c.section ? `, ${c.section}` : ''}
            </button>
            {open === c.n && (
              <blockquote className="mt-1 border-l-2 border-indigo-300 pl-2 text-gray-700 whitespace-pre-wrap">
                {chunk ? chunk.content : 'Loading...'}
              </blockquote>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default Citations;
