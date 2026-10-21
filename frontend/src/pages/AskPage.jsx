import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, Spinner } from '../components/ui';
import AgentPanel from '../components/Agent/AgentPanel';
import SourcePicker from '../components/Agent/SourcePicker';
import { useDocuments, useFiles } from '../hooks/useWorkspaceData';

// Questions across several tables and documents. To ask about one file, use the Ask AI tab on
// that table or document instead.
function AskPage() {
  const navigate = useNavigate();
  const { files, loading: filesLoading } = useFiles();
  const { documents, loading: docsLoading } = useDocuments();
  const [scope, setScope] = useState(null);

  // Start with everything selected once both lists have loaded.
  useEffect(() => {
    if (scope || filesLoading || docsLoading) return;
    setScope({
      fileIds: files.filter((f) => !f.status || f.status === 'ready').map((f) => f.id),
      documentIds: documents.map((d) => d.id),
    });
  }, [scope, files, documents, filesLoading, docsLoading]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Ask AI"
        description="Ask a question in plain English across several files. Choose exactly which tables and documents the AI may use; files that are not selected are ignored, even if they have columns with the same names."
      />
      <p className="text-xs text-slate-500 mb-3">
        Asking about a single file? Open it on the{' '}
        <Link to="/app/data" className="text-indigo-600 hover:underline">
          Data
        </Link>{' '}
        or{' '}
        <Link to="/app/documents" className="text-indigo-600 hover:underline">
          Documents
        </Link>{' '}
        page and use its Ask AI tab.{' '}
        <Link to="/app/history" className="text-indigo-600 hover:underline">
          See past runs
        </Link>
      </p>
      {!scope ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="w-6 h-6" />
        </div>
      ) : (
        <>
          <SourcePicker files={files} documents={documents} value={scope} onChange={setScope} />
          <AgentPanel
            scope={scope}
            onOpenSql={(sql) =>
              scope.fileIds[0] &&
              navigate(`/app/data/${scope.fileIds[0]}/sql?sql=${encodeURIComponent(sql)}`)
            }
          />
        </>
      )}
    </div>
  );
}

export default AskPage;
