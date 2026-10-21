-- Workspace invite codes. Joining a workspace that already has members requires its code.
-- Codes are generated on first use by the API (crypto random), so existing rows start NULL.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS invite_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_invite_code ON workspaces(invite_code);
