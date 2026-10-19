const pool = require('../config/database');

// Get recent chat messages
exports.getMessages = async (req, res) => {
  try {
    const workspaceId = req.workspaceId;
    const limit = Math.min(200, parseInt(req.query.limit) || 50);

    const query = `
      SELECT 
        cm.id,
        cm.message,
        cm.sent_at,
        cm.username,
        cm.workspace_id
      FROM chat_messages cm
      WHERE cm.workspace_id = $1
      ORDER BY cm.sent_at DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [workspaceId, limit]);

    const messages = result.rows.reverse();

    res.json({ messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
};

// Send a chat message
exports.sendMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.userId;
    const username = req.username;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    const query = `
      INSERT INTO chat_messages (user_id, username, message, workspace_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    const result = await pool.query(query, [userId, username, message.trim(), req.workspaceId]);
    const newMessage = result.rows[0];

    req.app.get('broadcast')(req.workspaceId, 'chat:message', {
      id: newMessage.id,
      username: newMessage.username,
      message: newMessage.message,
      sent_at: newMessage.sent_at,
    });

    res.status(201).json({ message: newMessage });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};
