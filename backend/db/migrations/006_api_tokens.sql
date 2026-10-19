-- Phase 8: workspace-scoped API tokens for the MCP server. Only a SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS api_tokens (
    id SERIAL PRIMARY KEY,
    workspace_id VARCHAR(50) NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    token_prefix TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_workspace ON api_tokens(workspace_id);
