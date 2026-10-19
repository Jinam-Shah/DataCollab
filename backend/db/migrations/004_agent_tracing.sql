-- Phase 3/4: column descriptions for the agent's get_schema tool, and agent run tracing.
ALTER TABLE csv_columns ADD COLUMN IF NOT EXISTS description TEXT;

CREATE TABLE IF NOT EXISTS agent_runs (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    workspace_id VARCHAR(50) NOT NULL,
    question TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'agent',           -- 'agent' or 'single_shot'
    model TEXT,
    prompt_variant TEXT,
    status TEXT NOT NULL DEFAULT 'running',       -- running | answered | gave_up | error
    final_sql TEXT,
    answer TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    latency_ms INTEGER,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'app',           -- 'app', 'eval', 'mcp'
    eval_run TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_steps (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    step_type TEXT NOT NULL,                      -- plan, get_schema, write_sql, run_sql, check_result, answer, give_up, search_documents
    prompt TEXT,
    tool_name TEXT,
    tool_input JSONB,
    tool_output JSONB,
    error TEXT,
    latency_ms INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace ON agent_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_eval ON agent_runs(eval_run) WHERE eval_run IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, step_index);
