# Connecting an MCP client to DataCollab

DataCollab includes a [Model Context Protocol](https://modelcontextprotocol.io) server built
with the official TypeScript SDK (`@modelcontextprotocol/sdk`). Each server is bound to one
workspace through an API token and exposes four read-only tools:

| Tool | What it does |
|---|---|
| `list_tables` | Tables in the workspace with row counts |
| `describe_table` | Columns, types, sample values and statistics for one table |
| `run_readonly_query` | One PostgreSQL SELECT through the same safety layer as the app (read-only role, 5 s timeout, 1000-row pages) |
| `search_documents` | Hybrid keyword and semantic search over the workspace's documents |

## 1. Create a token

In the app, open **Integrations → Access tokens → Create token** (the page also generates the client config with the token filled in), or call the API:

```bash
curl -X POST http://localhost:5000/api/tokens \
  -H "Authorization: Bearer <your login JWT>" -H "Content-Type: application/json" \
  -d '{"name": "Claude Desktop"}'
```

The token (`dc_...`) is shown once. Only its SHA-256 hash is stored. Revoke it from the same panel
or with `DELETE /api/tokens/:id`.

## 2a. HTTP transport (remote or local server)

The API serves MCP's Streamable HTTP transport at `POST /mcp`, in stateless mode. Send the token
as a bearer token. For a client that supports remote HTTP servers:

```json
{
  "mcpServers": {
    "datacollab": {
      "type": "http",
      "url": "https://<your-api-host>/mcp",
      "headers": { "Authorization": "Bearer dc_your_token" }
    }
  }
}
```

With Claude Code: `claude mcp add --transport http datacollab https://<your-api-host>/mcp --header "Authorization: Bearer dc_your_token"`.

## 2b. stdio transport (local)

The stdio server connects to the database directly, so it needs the same database settings as the API:

```json
{
  "mcpServers": {
    "datacollab": {
      "command": "node",
      "args": ["/path/to/DataCollab/backend/dist/mcp/stdio.js"],
      "env": {
        "DATACOLLAB_TOKEN": "dc_your_token",
        "DATABASE_URL": "postgresql://datacollab:...@localhost:5432/datacollab",
        "DATABASE_READER_URL": "postgresql://datacollab_reader:...@localhost:5432/datacollab"
      }
    }
  }
}
```

Run `npm run build` in `backend/` first. In development, `npx tsx mcp/stdio.ts` works as the command.

## Inspecting it

```bash
npx @modelcontextprotocol/inspector node backend/dist/mcp/stdio.js
```

## Tests

`backend/tests/mcp.test.ts` covers every tool over an in-memory transport, the HTTP transport
(valid, wrong and revoked tokens, workspace scoping), and the stdio transport as a real subprocess.
