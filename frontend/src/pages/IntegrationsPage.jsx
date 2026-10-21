import React, { useState } from 'react';
import { Button, Card, CardHeader, PageHeader } from '../components/ui';
import ApiTokens from '../components/Settings/ApiTokens';

const API_URL = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/+$/, '');

const TOOLS = [
  ['list_tables', 'see which tables exist'],
  ['describe_table', 'read columns, types and sample values'],
  ['run_readonly_query', 'run a SELECT (same safety rules as the SQL page)'],
  ['search_documents', 'search your uploaded documents'],
];

function CopyBlock({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable on plain http; the text can still be selected by hand.
    }
  };
  return (
    <div className="relative">
      <pre className="bg-slate-900 text-slate-100 text-xs p-3 pr-20 rounded-lg overflow-x-auto">
        {text}
      </pre>
      <Button
        size="sm"
        variant="secondary"
        icon={copied ? 'check' : 'copy'}
        onClick={copy}
        className="absolute top-2 right-2"
        aria-label={`Copy ${label}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

// Explains MCP in plain words and lets the user create a token for an AI app.
function IntegrationsPage() {
  const [token, setToken] = useState('');
  const shown = token || 'dc_your_token';
  const desktop = JSON.stringify(
    {
      mcpServers: {
        // Claude Desktop starts local (stdio) servers; mcp-remote bridges to the HTTP endpoint.
        datacollab: {
          command: 'npx',
          args: ['-y', 'mcp-remote', `${API_URL}/mcp`, '--header', 'Authorization:${AUTH}'],
          env: { AUTH: `Bearer ${shown}` },
        },
      },
    },
    null,
    2
  );
  const cli = `claude mcp add --transport http datacollab ${API_URL}/mcp --header "Authorization: Bearer ${shown}"`;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Integrations"
        description="Let other AI apps, such as Claude Desktop or Claude Code, read the data in this workspace. This is optional; you do not need it to use DataCollab."
      />

      <Card>
        <CardHeader title="What is this?" />
        <div className="p-5 text-sm text-slate-700 space-y-3">
          <p>
            DataCollab speaks the <strong>Model Context Protocol (MCP)</strong>, a standard way for
            AI assistants to use outside tools. Once connected, you can ask Claude in its own app
            things like &quot;what tables do I have in DataCollab?&quot; and it will look them up
            here.
          </p>
          <p>The app gets four read-only tools. It can never change or delete your data:</p>
          <ul className="grid sm:grid-cols-2 gap-2">
            {TOOLS.map(([name, what]) => (
              <li key={name} className="border border-slate-200 rounded-lg px-3 py-2">
                <code className="font-mono text-indigo-700">{name}</code>
                <span className="block text-xs text-slate-500">{what}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <CardHeader title="How to connect" />
        <ol className="p-5 text-sm text-slate-700 space-y-4 list-decimal list-inside">
          <li>Create a token below. Copy it right away; it is shown only once.</li>
          <li>
            Claude Desktop: open Settings → Developer → Edit config, and add this to{' '}
            <code className="font-mono">claude_desktop_config.json</code>, then restart Claude
            Desktop. It needs Node.js installed.
            <div className="mt-2">
              <CopyBlock text={desktop} label="Claude Desktop config" />
            </div>
          </li>
          <li>
            Claude Code: run this in a terminal.
            <div className="mt-2">
              <CopyBlock text={cli} label="Claude Code command" />
            </div>
          </li>
          <li>To cut off an app, revoke its token. Keep tokens private, like passwords.</li>
        </ol>
      </Card>

      <ApiTokens onCreated={setToken} />
    </div>
  );
}

export default IntegrationsPage;
