const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ensureWorkspace } = require('../services/workspaceService');

// Generate JWT token
const generateToken = (userId, username, workspaceId) => {
  return jwt.sign({ userId, username, workspaceId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Register new user
exports.register = async (req, res) => {
  try {
    const { username, email, password, workspaceId } = req.body;

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

    const finalWorkspaceId = (workspaceId || 'default').trim();
    if (!/^[A-Za-z0-9_.-]{1,50}$/.test(finalWorkspaceId)) {
      return res.status(400).json({
        error: 'Workspace ID must be 1-50 letters, digits, dots, dashes or underscores',
      });
    }

    // Create the workspace (schema + read-only role) on first use, then the user
    await ensureWorkspace(finalWorkspaceId);
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
