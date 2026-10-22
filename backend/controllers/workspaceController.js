const pool = require('../config/database');
const {
  ensureWorkspace,
  getInviteCode,
  rotateInviteCode,
} = require('../services/workspaceService');

// GET /api/workspace  The caller's workspace: invite code and members.
exports.get = async (req, res) => {
  try {
    const workspace = await ensureWorkspace(req.workspaceId);
    const { rows } = await pool.query(
      `SELECT id, username, created_at FROM users WHERE workspace_id = $1 ORDER BY created_at`,
      [req.workspaceId]
    );
    res.json({
      workspace: {
        slug: workspace.slug,
        inviteCode: await getInviteCode(workspace.id),
        members: rows,
      },
    });
  } catch (error) {
    console.error('Get workspace error:', error);
    res.status(500).json({ error: 'Failed to load workspace' });
  }
};

// POST /api/workspace/invite-code  Issue a new invite code; the old one stops working.
exports.rotateInvite = async (req, res) => {
  try {
    const workspace = await ensureWorkspace(req.workspaceId);
    res.json({ inviteCode: await rotateInviteCode(workspace.id) });
  } catch (error) {
    console.error('Rotate invite error:', error);
    res.status(500).json({ error: 'Failed to create a new invite code' });
  }
};
