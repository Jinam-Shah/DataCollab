const jwt = require('jsonwebtoken');
const User = require('../models/User');
const nodeCrypto = require('crypto');
const {
  ensureWorkspace,
  getWorkspace,
  getInviteCode,
  inviteCodeMatches,
  countMembers,
} = require('../services/workspaceService');

const WORKSPACE_RE = /^[A-Za-z0-9_.-]{1,50}$/;

// A free workspace name for someone who left the field blank: their username, plus a short
// random suffix if a workspace with that name already has members.
async function personalWorkspace(username) {
  const base = username.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'workspace';
  let slug = base;
  for (let i = 0; i < 5 && (await countMembers(slug)) > 0; i++) {
    slug = `${base}-${nodeCrypto.randomBytes(3).toString('hex')}`;
  }
  return slug;
}

// Generate JWT token
const generateToken = (userId, username, workspaceId) => {
  return jwt.sign({ userId, username, workspaceId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Register new user
exports.register = async (req, res) => {
  try {
    const { username, email, password, workspaceId, inviteCode } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if email already exists
    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Check if username already exists
    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Blank workspace: create a private one. Named workspace: create it if it is new, otherwise
    // joining it needs the invite code that its members can see on the Team page.
    const requested = (workspaceId || '').trim();
    if (requested && !WORKSPACE_RE.test(requested)) {
      return res.status(400).json({
        error: 'Workspace ID must be 1-50 letters, digits, dots, dashes or underscores',
      });
    }
    const finalWorkspaceId = requested || (await personalWorkspace(username));
    const existing = await getWorkspace(finalWorkspaceId);
    const joining = existing && (await countMembers(finalWorkspaceId)) > 0;
    if (joining && !inviteCodeMatches(await getInviteCode(existing.id), inviteCode)) {
      return res.status(403).json({
        error: inviteCode
          ? 'That invite code is not valid for this workspace'
          : `Workspace "${finalWorkspaceId}" already exists. Ask a member for its invite code, or leave the workspace blank to create your own.`,
        code: 'INVITE_REQUIRED',
      });
    }

    // Create the workspace (schema + read-only role) on first use, then the user
    const workspace = await ensureWorkspace(finalWorkspaceId);
    const user = await User.create(username, email, password, finalWorkspaceId);

    // Generate token with workspace
    const token = generateToken(user.id, user.username, user.workspace_id);

    console.log(
      `New user registered: ${user.username} (${user.email}) in workspace: ${user.workspace_id}`
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        workspaceId: user.workspace_id,
      },
      // Shown to whoever creates a workspace, so they can invite teammates straight away.
      ...(!joining && { inviteCode: await getInviteCode(workspace.id) }),
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isValidPassword = await User.verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate token with workspace
    const token = generateToken(user.id, user.username, user.workspace_id);

    console.log(`User logged in: ${user.username} in workspace: ${user.workspace_id}`);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        workspaceId: user.workspace_id,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

// Get current user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
};
