import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { getSocket } from '../../services/socket';

// Upload PDFs, Markdown or text files (data dictionaries, reports) for the agent to search.
function DocumentsPanel() {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/documents');
      setDocuments(res.data.documents);
    } catch {
      setError('Failed to load documents');
    }
  }, []);

  useEffect(() => {
    load();
    const socket = getSocket();
    if (!socket) return undefined;
    socket.on('document:uploaded', load);
    socket.on('document:deleted', load);
    return () => {
      socket.off('document:uploaded', load);
      socket.off('document:deleted', load);
    };
  }, [load]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      await api.post('/api/documents', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    await api.delete(`/api/documents/${id}`);
    await load();
  };

  return (
    <div className="bg-white rounded-lg shadow p-6" data-testid="documents-panel">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Documents</h2>
      <p className="text-sm text-gray-600 mb-3">
        PDF, Markdown or text. The agent searches these and cites them in answers.
      </p>
      {error && <p className="text-sm text-red-700 mb-2">{error}</p>}
      <label
        htmlFor="document-input"
        className="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg cursor-pointer hover:bg-indigo-700 mb-3"
      >
        {uploading ? 'Processing...' : 'Upload document'}
      </label>
      <input
        id="document-input"
        type="file"
        accept=".pdf,.md,.markdown,.txt"
        className="hidden"
        onChange={handleFile}
        disabled={uploading}
      />
      {documents.length === 0 ? (
        <p className="text-sm text-gray-500">No documents yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {documents.map((d) => (
            <li key={d.id} className="py-2 flex justify-between items-center">
              <span>
                <span className="font-medium text-gray-900">{d.filename}</span>
                <span className="text-gray-500">
                  {' '}
                  · {d.page_count ? `${d.page_count} pages · ` : ''}
                  {d.chunk_count} passages
                </span>
              </span>
              <button
                onClick={() => handleDelete(d.id)}
                className="text-red-600 hover:underline"
                aria-label={`Delete ${d.filename}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default DocumentsPanel;
