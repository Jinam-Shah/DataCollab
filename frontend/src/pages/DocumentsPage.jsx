import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Icon,
  PageHeader,
  Spinner,
  formatBytes,
} from '../components/ui';
import { useDocuments } from '../hooks/useWorkspaceData';
import { useToast } from '../components/Toasts';

function DocumentViewer({ id, onDeleted }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/documents/${id}`)
      .then((res) => !cancelled && setData(res.data))
      .catch(() => !cancelled && setError('Could not load this document'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <Card className="p-6 text-sm text-red-700">{error}</Card>;
  if (!data) {
    return (
      <Card className="p-10 flex justify-center text-slate-400">
        <Spinner className="w-6 h-6" />
      </Card>
    );
  }

  const { document: doc, chunks } = data;
  const remove = async () => {
    if (!window.confirm(`Delete ${doc.filename}? The AI will stop using it.`)) return;
    await api.delete(`/api/documents/${doc.id}`);
    onDeleted();
  };

  return (
    <Card data-testid="document-viewer">
      <CardHeader
        title={doc.filename}
        subtitle={`${formatBytes(doc.file_size)} · ${doc.page_count ? `${doc.page_count} pages · ` : ''}${chunks.length} passages`}
        actions={
          <Button
            variant="danger"
            size="sm"
            icon="trash"
            onClick={remove}
            aria-label={`Delete ${doc.filename}`}
          >
            Delete
          </Button>
        }
      />
      <div className="p-5">
        <p className="text-xs text-slate-500 mb-3">
          This is the text the AI searches, split into passages. When an answer uses one, it cites
          it as [1], [2], ...
        </p>
        <ol className="space-y-3">
          {chunks.map((c) => (
            <li key={c.id} className="border border-slate-200 rounded-lg p-3">
              <div className="flex gap-2 mb-1.5">
                <Badge>#{c.chunk_index + 1}</Badge>
                {c.page && <Badge color="indigo">page {c.page}</Badge>}
                {c.section && <Badge color="indigo">{c.section}</Badge>}
              </div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.content}</p>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

// Documents are background knowledge for the AI (data dictionaries, reports, notes). They are not
// tables and cannot be queried with SQL.
function DocumentsPage() {
  const { documents, loading, reload } = useDocuments();
  const { docId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const selectedId = docId ? Number(docId) : null;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.post('/api/documents', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await reload();
      toast(`${file.name} is ready for the AI`, 'success');
      navigate(`/app/documents/${res.data.document.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Give the AI background knowledge: data dictionaries, reports, notes. Documents are not tables; you cannot query them with SQL. Instead, Ask AI searches them and cites the passages it used."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Add a document" subtitle="PDF, Markdown (.md) or text (.txt)" />
            <div className="p-4">
              {error && (
                <div className="mb-3">
                  <Alert>{error}</Alert>
                </div>
              )}
              <label
                htmlFor="document-input"
                className={`flex items-center justify-center gap-2 w-full border-2 border-dashed rounded-lg p-4 text-sm cursor-pointer ${
                  uploading
                    ? 'border-slate-200 text-slate-400'
                    : 'border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-700'
                }`}
              >
                {uploading ? <Spinner /> : <Icon name="upload" className="w-5 h-5" />}
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
            </div>
          </Card>

          <Card data-testid="documents-panel">
            <CardHeader title="Documents" subtitle={`${documents.length} in this workspace`} />
            {loading ? (
              <div className="p-6 flex justify-center text-slate-400">
                <Spinner />
              </div>
            ) : documents.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 text-center">No documents yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {documents.map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => navigate(`/app/documents/${d.id}`)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 ${
                        selectedId === d.id ? 'bg-indigo-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <Icon
                        name="file"
                        className={`w-5 h-5 mt-0.5 ${selectedId === d.id ? 'text-indigo-600' : 'text-slate-400'}`}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-900 truncate">
                          {d.filename}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {d.page_count ? `${d.page_count} pages · ` : ''}
                          {d.chunk_count} passages{d.username ? ` · ${d.username}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0">
          {selectedId ? (
            <DocumentViewer
              key={selectedId}
              id={selectedId}
              onDeleted={() => {
                reload();
                navigate('/app/documents');
              }}
            />
          ) : (
            <Card>
              <EmptyState
                icon="file"
                title={documents.length ? 'Select a document' : 'No documents yet'}
              >
                {documents.length
                  ? 'Pick a document on the left to read the passages the AI can search.'
                  : 'Upload a data dictionary or report. Then ask a question like "What does the cause column mean?" on the Ask AI page.'}
              </EmptyState>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default DocumentsPage;
