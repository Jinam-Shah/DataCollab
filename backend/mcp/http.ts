// Streamable HTTP transport for MCP at POST /mcp, authenticated with a workspace API token
// (Authorization: Bearer dc_...). Stateless: each request gets a fresh server and transport.
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';
import { resolveToken } from '../services/apiTokens';
import { ensureWorkspace } from '../services/workspaceService';

export const mcpRouter = express.Router();

mcpRouter.post('/', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const resolved = await resolveToken(token);
  if (!resolved) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Invalid or missing API token' },
      id: null,
    });
    return;
  }
  try {
    const workspace = await ensureWorkspace(resolved.workspaceSlug);
    const server = createMcpServer(workspace);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request error:', err);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
});

// Stateless mode has no server-initiated streams or sessions to end.
mcpRouter.all('/', (req, res) => {
  res
    .status(405)
    .set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
});
