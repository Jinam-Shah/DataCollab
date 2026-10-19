const pool = require('../config/database');

// Load a file's metadata only if it belongs to the caller's workspace. Returns null otherwise,
// so callers answer 404 without revealing whether the id exists in another workspace.
async function getFileForWorkspace(fileId, workspaceSlug) {
  if (!/^\d+$/.test(String(fileId))) return null;
  const { rows } = await pool.query(
    `SELECT f.*, u.username, w.schema_name, w.id AS ws_id
       FROM csv_files f
       JOIN users u ON f.user_id = u.id
       JOIN workspaces w ON w.slug = f.workspace_id
      WHERE f.id = $1 AND f.workspace_id = $2`,
    [fileId, workspaceSlug]
  );
  return rows[0] || null;
}

module.exports = { getFileForWorkspace };
