// MCP over stdio for local clients:
//   DATACOLLAB_TOKEN=dc_... DATABASE_URL=... DATABASE_READER_URL=... node dist/mcp/stdio.js
// stdout carries the protocol, so anything that logs (dotenv included) must go to stderr. The
// redirect is the first statement, and modules are loaded with require() after it, because
// import declarations would be hoisted above it.
console.log = console.error;
console.info = console.error;
require('dotenv').config();

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createMcpServer } = require('./server');
const { resolveToken } = require('../services/apiTokens');
const { ensureWorkspace } = require('../services/workspaceService');
const { initSqlGuard } = require('../security/sqlGuard');

async function main() {
  const resolved = await resolveToken(process.env.DATACOLLAB_TOKEN);
  if (!resolved) throw new Error('Set DATACOLLAB_TOKEN to a valid workspace API token');
  await initSqlGuard();
  const workspace = await ensureWorkspace(resolved.workspaceSlug);
  await createMcpServer(workspace).connect(new StdioServerTransport());
  console.error(`DataCollab MCP server ready for workspace "${workspace.slug}"`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
