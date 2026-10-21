import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import AgentPanel from '../components/Agent/AgentPanel';
import { useDocuments, useFiles } from '../hooks/useWorkspaceData';

function AskPage() {
  const navigate = useNavigate();
  const { files } = useFiles();
  const { documents } = useDocuments();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Ask AI"
        description="Ask questions in plain English. The answer comes from SQL run on your tables, and from your uploaded documents when the question is about definitions or context."
      />
      <p className="text-xs text-slate-500 mb-3">
        Using {files.length} table(s) and {documents.length} document(s) from this workspace.{' '}
        <Link to="/app/history" className="text-indigo-600 hover:underline">
          See past runs
        </Link>
      </p>
      <AgentPanel onOpenSql={(sql) => navigate(`/app/sql?sql=${encodeURIComponent(sql)}`)} />
    </div>
  );
}

export default AskPage;
