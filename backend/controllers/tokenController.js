const pool = require('../config/database');
const { createToken } = require('../services/apiTokens');

// POST /api/tokens { name }  Returns the token once.
exports.create = async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 100)
    return res.status(400).json({ error: 'name is required (max 100 characters)' });
  try {
    const token = await createToken(req.workspaceId, req.userId, name);
    res.status(201).json({ token });
  } catch (error) {
    console.error('Create token error:', error);
    res.status(500).json({ error: 'Failed to create token' });
  }
};

exports.list = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, token_prefix, created_at, last_used_at FROM api_tokens
      WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [req.workspaceId]
  );
  res.json({ tokens: rows });
};

exports.revoke = async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Token not found' });
  const { rowCount } = await pool.query(
    'DELETE FROM api_tokens WHERE id = $1 AND workspace_id = $2',
    [req.params.id, req.workspaceId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Token not found' });
  res.json({ message: 'Token revoked' });
};
