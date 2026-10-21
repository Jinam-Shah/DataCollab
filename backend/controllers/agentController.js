const pool = require('../config/database');
const { ensureWorkspace } = require('../services/workspaceService');
const { ask } = require('../agent/service');

const isIdList = (v) =>
  Array.isArray(v) &&
  v.length <= 100 &&
  v.every((x) => Number.isInteger(Number(x)) && Number(x) > 0);

// Turns the selected file and document ids into an agent scope. Ids from another workspace are
// dropped, so a request cannot reach outside the caller's workspace.
async function resolveScope(workspaceSlug, fileIds, documentIds) {
  if (fileIds === undefined && documentIds === undefined) return undefined;
  const scope = { tables: [], documentIds: [] };
  if (fileIds?.length) {
    const { rows } = await pool.query(
      `SELECT table_name FROM csv_files
        WHERE workspace_id = $1 AND id = ANY($2::bigint[]) AND status = 'ready'`,
      [workspaceSlug, fileIds.map(Number)]
    );
    scope.tables = rows.map((r) => r.table_name);
  }
  if (documentIds?.length) {
    const { rows } = await pool.query(
      'SELECT id::int AS id FROM documents WHERE workspace_id = $1 AND id = ANY($2::bigint[])',
      [workspaceSlug, documentIds.map(Number)]
    );
    scope.documentIds = rows.map((r) => r.id);
  }
  return scope;
}

// POST /api/agent/ask  { question, mode?: 'agent' | 'single_shot', requestId?, fileIds?, documentIds? }
// fileIds/documentIds limit the run to those tables and documents; omit both to use everything.
// Steps stream to the caller's sockets as `agent:step` events while the run is in progress.
exports.ask = async (req, res) => {
  const { question, mode = 'agent', requestId = null, fileIds, documentIds } = req.body || {};
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }
  if (question.length > 2000) {
    return res.status(400).json({ error: 'Question is too long (max 2000 characters)' });
  }
  if (!['agent', 'single_shot'].includes(mode)) {
    return res.status(400).json({ error: "mode must be 'agent' or 'single_shot'" });
  }
  if (
    (fileIds !== undefined && !isIdList(fileIds)) ||
    (documentIds !== undefined && !isIdList(documentIds))
  ) {
    return res.status(400).json({ error: 'fileIds and documentIds must be lists of ids' });
  }

  try {
    const workspace = await ensureWorkspace(req.workspaceId);
    const emitToUser = req.app.get('emitToUser');
    const scope = await resolveScope(req.workspaceId, fileIds, documentIds);
    if (scope && scope.tables.length === 0 && scope.documentIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one table or document to ask about' });
    }
    const result = await ask({
      workspace,
      question: question.trim(),
      mode,
      scope,
      userId: req.userId,
      onStep: (runId, step) =>
        emitToUser(req.userId, 'agent:step', {
          requestId,
          runId,
          type: step.type,
          message: step.message,
          sql: step.toolInput && step.toolInput.sql ? step.toolInput.sql : undefined,
          error: step.error,
        }),
    });
    if (result.status === 'error') {
      return res.status(502).json({ error: `Agent failed: ${result.error}`, runId: result.runId });
    }
    res.json({
      runId: result.runId,
      status: result.status,
      answer: result.answer,
      sql: result.sql,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      hasMore: result.hasMore,
      attempts: result.attempts,
      citations: result.citations,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    if (/GEMINI_API_KEY/.test(error.message)) {
      return res.status(503).json({ error: 'The AI model is not configured on this server' });
    }
    console.error('Agent error:', error);
    res.status(500).json({ error: 'Agent run failed' });
  }
};

// GET /api/agent/runs?limit=20&before=<id>  Run history for the workspace.
exports.listRuns = async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
    const before = parseInt(req.query.before, 10) || null;
    const { rows } = await pool.query(
      `SELECT r.id::int AS id, r.question, r.mode, r.model, r.prompt_variant, r.status, r.final_sql, r.answer,
              r.attempts, r.error, r.latency_ms, r.input_tokens, r.output_tokens, r.source,
              r.created_at, u.username
         FROM agent_runs r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.workspace_id = $1 AND ($2::bigint IS NULL OR r.id < $2)
        ORDER BY r.id DESC LIMIT $3`,
      [req.workspaceId, before, limit]
    );
    res.json({ runs: rows });
  } catch (error) {
    console.error('List runs error:', error);
    res.status(500).json({ error: 'Failed to list runs' });
  }
};

// GET /api/agent/runs/:id  One run with all of its steps.
exports.getRun = async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Run not found' });
    const run = await pool.query('SELECT * FROM agent_runs WHERE id = $1 AND workspace_id = $2', [
      req.params.id,
      req.workspaceId,
    ]);
    if (!run.rows[0]) return res.status(404).json({ error: 'Run not found' });
    const steps = await pool.query(
      `SELECT step_index, step_type, prompt, tool_name, tool_input, tool_output, error, latency_ms,
              input_tokens, output_tokens, created_at
         FROM agent_steps WHERE run_id = $1 ORDER BY step_index`,
      [req.params.id]
    );
    res.json({ run: run.rows[0], steps: steps.rows });
  } catch (error) {
    console.error('Get run error:', error);
    res.status(500).json({ error: 'Failed to get run' });
  }
};
