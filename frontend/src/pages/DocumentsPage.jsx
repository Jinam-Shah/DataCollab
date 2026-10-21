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
  Tabs,
  formatBytes,
} from '../components/ui';
import { useDocuments, useFiles } from '../hooks/useWorkspaceData';
import AgentPanel from '../components/Agent/AgentPanel';
import SourcePicker from '../components/Agent/SourcePicker';
import { useToast } from '../components/Toasts';

// The AI tab of a document: always this document, plus any tables the user adds.
function AskThisDocument({ doc }) {
  const { files } = useFiles();
  const navigate = useNavigate();
  const [scope, setScope] = useState({ fileIds: [], documentIds: [doc.id] });
  const firstTable = scope.fileIds[0];
  return (
    <div>
      <SourcePicker
        files={files}
        documents={[{ id: doc.id, filename: doc.filename }]}
        value={scope}
        onChange={setScope}
        lockedDocumentId={doc.id}
      />
      <AgentPanel
        scope={scope}
        intro={`Answers come only from ${doc.filename}${
          scope.fileIds.length ? ' and the tables you selected' : ''
        }, with the passages cited. Add a table above to combine it with real numbers.`}
        suggestions={[
          `Summarize ${doc.filename}`,
          'What does each column mean?',
          'Are there any caveats I should know about?',
        ]}
        onOpenSql={
          firstTable
            ? (sql) => navigate(`/app/data/${firstTable}/sql?sql=${encodeURIComponent(sql)}`)
            : undefined
        }
      />
    </div>
  );
}

function DocumentViewer({ id, tab, onTab, onDeleted }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const active = tab === 'ask' ? 'ask' : 'passages';

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
      <Tabs
        tabs={[
          { id: 'passages', label: 'Passages' },
          { id: 'ask', label: 'Ask AI' },
        ]}
        active={active}
        onChange={onTab}
      />
      <div className="p-5">
        {active === 'passages' && (
          <>
            <p className="text-xs text-slate-500 mb-3">
              This is the text the AI searches, split into passages. When an answer uses one, it
              cites it as [1], [2], ...
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
          </>
        )}
        {active === 'ask' && <AskThisDocument doc={doc} />}
      </div>
    </Card>
  );
}

// Documents are background knowledge for the AI (data dictionaries, reports, notes). They are not
// tables and cannot be queried with SQL.
function DocumentsPage() {
  const { documents, loading, reload } = useDocuments();
  const { docId, tab } = useParams();
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
        description="Give the AI background knowledge: data dictionaries, reports, notes. Documents are not tables; you cannot query them with SQL. Open a document and use its Ask AI tab, and the AI answers from it with the passages cited."
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
                      onClick={() => navigate(`/app/documents/${d.id}${tab ? `/${tab}` : ''}`)}
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
              tab={tab}
              onTab={(t) => navigate(`/app/documents/${selectedId}/${t}`)}
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
