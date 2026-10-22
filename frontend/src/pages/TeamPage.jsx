import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { getUser } from '../utils/auth';
import { Button, Card, CardHeader, PageHeader, Spinner } from '../components/ui';
import { useToast } from '../components/Toasts';

// Who is in this workspace, and the invite code a teammate needs to join it.
function TeamPage() {
  const [workspace, setWorkspace] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const me = getUser()?.username;

  useEffect(() => {
    api
      .get('/api/workspace')
      .then((res) => setWorkspace(res.data.workspace))
      .catch(() => setError('Could not load the workspace'));
  }, []);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard needs https; the code can still be selected by hand.
    }
  };

  const rotate = async () => {
    if (
      !window.confirm(
        'Create a new invite code? The current code stops working. People already in the workspace stay in.'
      )
    )
      return;
    const res = await api.post('/api/workspace/invite-code');
    setWorkspace((w) => ({ ...w, inviteCode: res.data.inviteCode }));
    toast('New invite code created', 'success');
  };

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!workspace) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Spinner className="w-6 h-6" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Team"
        description="Everyone in this workspace shares its tables, documents, AI runs and chat. A teammate needs the workspace ID and the invite code below to join."
      />

      <Card>
        <CardHeader
          title="Invite a teammate"
          subtitle="Send them both values; they enter them on the sign-up page."
        />
        <div className="p-5 grid sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">Workspace ID</p>
            <code className="block font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              {workspace.slug}
            </code>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Invite code</p>
            <div className="flex gap-2">
              <code
                className="flex-1 font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
                data-testid="invite-code"
              >
                {workspace.inviteCode}
              </code>
              <Button
                variant="secondary"
                size="sm"
                icon={copied ? 'check' : 'copy'}
                onClick={() => copy(workspace.inviteCode)}
                aria-label="Copy invite code"
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Think the code was shared too widely? Make a new one; the old one stops working.
          </p>
          <Button variant="secondary" size="sm" icon="refresh" onClick={rotate}>
            New invite code
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Members" subtitle={`${workspace.members.length} in this workspace`} />
        <ul className="divide-y divide-slate-100" data-testid="members">
          {workspace.members.map((m) => (
            <li key={m.id} className="px-5 py-3 flex items-center justify-between text-sm">
              <span className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center font-medium">
                  {m.username.slice(0, 1).toUpperCase()}
                </span>
                <span className="font-medium text-slate-900">
                  {m.username}
                  {m.username === me && <span className="text-slate-400 font-normal"> (you)</span>}
                </span>
              </span>
              <span className="text-xs text-slate-500">
                joined {new Date(m.created_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default TeamPage;
