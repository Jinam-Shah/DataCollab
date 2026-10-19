// Workspace-scoped API tokens (used by the MCP server). The plaintext token is shown once at
// creation; the database keeps only its SHA-256 hash, so a database leak does not leak tokens.
import crypto from 'crypto';
const pool = require('../config/database');

const PREFIX = 'dc_';

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export async function createToken(workspaceSlug: string, userId: number | null, name: string) {
  const token = PREFIX + crypto.randomBytes(24).toString('base64url');
  const { rows } = await pool.query(
    `INSERT INTO api_tokens (workspace_id, user_id, name, token_hash, token_prefix)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name, token_prefix, created_at`,
    [workspaceSlug, userId, name, hash(token), token.slice(0, 8)]
  );
  return { ...rows[0], token };
}

export async function resolveToken(
  token: string | undefined | null
): Promise<{ tokenId: number; workspaceSlug: string; userId: number | null } | null> {
  if (!token || !token.startsWith(PREFIX)) return null;
  const { rows } = await pool.query(
    'UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING id, workspace_id, user_id',
    [hash(token)]
  );
  if (!rows[0]) return null;
  return { tokenId: rows[0].id, workspaceSlug: rows[0].workspace_id, userId: rows[0].user_id };
}
